import net from 'node:net';

export interface McPingResult {
  online: boolean;
  playersOnline: number;
  maxPlayers: number;
  playerNames: string[];
  motd: string;
  versionName: string;
  latencyMs: number;
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (true) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

function readVarInt(buf: Buffer, offset: number): { value: number; nextOffset: number } | null {
  let numRead = 0;
  let result = 0;
  let pos = offset;
  while (pos < buf.length) {
    const read = buf[pos++];
    const val = read & 0x7f;
    result |= val << (7 * numRead);
    numRead++;
    if (numRead > 5) throw new Error('VarInt too big');
    if ((read & 0x80) === 0) {
      return { value: result, nextOffset: pos };
    }
  }
  return null;
}

function writeString(str: string): Buffer {
  const data = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(data.length), data]);
}

function createPacket(packetId: number, payload: Buffer): Buffer {
  const body = Buffer.concat([writeVarInt(packetId), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

function extractMotdText(description: unknown): string {
  if (typeof description === 'string') return description;
  if (!description || typeof description !== 'object') return '';
  const obj = description as { text?: string; extra?: unknown[] };
  let out = typeof obj.text === 'string' ? obj.text : '';
  if (Array.isArray(obj.extra)) {
    for (const part of obj.extra) {
      out += extractMotdText(part);
    }
  }
  return out;
}

/**
 * Queries a local Minecraft Java Edition server using the modern Server List Ping (SLP) protocol.
 */
export function pingMinecraftServer(host = '127.0.0.1', port = 25565, timeoutMs = 1500): Promise<McPingResult | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const done = (result: McPingResult | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(null));
    socket.on('error', () => done(null));

    socket.on('connect', () => {
      // Handshake packet (ID 0x00): Protocol 763, Host, Port (UShort BE), Next State = 1 (Status)
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port, 0);
      const handshakePayload = Buffer.concat([
        writeVarInt(763),
        writeString(host),
        portBuf,
        writeVarInt(1),
      ]);
      const handshake = createPacket(0x00, handshakePayload);
      const statusRequest = createPacket(0x00, Buffer.alloc(0));
      socket.write(Buffer.concat([handshake, statusRequest]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const pktLen = readVarInt(buffer, 0);
        if (!pktLen) return;
        if (buffer.length < pktLen.nextOffset + pktLen.value) return;

        const pktId = readVarInt(buffer, pktLen.nextOffset);
        if (!pktId || pktId.value !== 0x00) {
          done(null);
          return;
        }
        const jsonLen = readVarInt(buffer, pktId.nextOffset);
        if (!jsonLen) return;
        const jsonStr = buffer.subarray(jsonLen.nextOffset, jsonLen.nextOffset + jsonLen.value).toString('utf8');
        const data = JSON.parse(jsonStr);

        const sample = Array.isArray(data?.players?.sample)
          ? data.players.sample
              .map((p: { name?: string }) => p?.name)
              .filter((n: unknown): n is string => typeof n === 'string' && n !== 'Anonymous Player')
          : [];

        done({
          online: true,
          playersOnline: typeof data?.players?.online === 'number' ? data.players.online : 0,
          maxPlayers: typeof data?.players?.max === 'number' ? data.players.max : 20,
          playerNames: sample,
          motd: extractMotdText(data?.description),
          versionName: typeof data?.version?.name === 'string' ? data.version.name : '',
          latencyMs: Date.now() - started,
        });
      } catch {
        done(null);
      }
    });
  });
}
