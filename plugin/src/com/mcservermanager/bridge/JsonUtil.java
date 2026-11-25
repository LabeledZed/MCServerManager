package com.mcservermanager.bridge;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Zero-dependency recursive JSON parser and serializer (Java 8 compatible).
 */
public final class JsonUtil {

    private JsonUtil() {}

    public static Object parse(String json) {
        if (json == null) return null;
        Parser p = new Parser(json);
        p.skipWs();
        if (p.eof()) return null;
        return p.readValue();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        Object val = parse(json);
        if (val instanceof Map) {
            return (Map<String, Object>) val;
        }
        return new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object obj) {
        if (obj instanceof Map) return (Map<String, Object>) obj;
        return null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> asList(Object obj) {
        if (obj instanceof List) return (List<Object>) obj;
        return null;
    }

    public static String asString(Object obj, String def) {
        if (obj == null) return def;
        return String.valueOf(obj);
    }

    public static boolean asBoolean(Object obj, boolean def) {
        if (obj instanceof Boolean) return (Boolean) obj;
        if (obj instanceof String) {
            String s = ((String) obj).trim();
            if ("true".equalsIgnoreCase(s)) return true;
            if ("false".equalsIgnoreCase(s)) return false;
        }
        return def;
    }

    public static int asInt(Object obj, int def) {
        if (obj instanceof Number) return ((Number) obj).intValue();
        if (obj instanceof String) {
            try { return Integer.parseInt(((String) obj).trim()); } catch (NumberFormatException ignored) {}
        }
        return def;
    }

    public static double asDouble(Object obj, double def) {
        if (obj instanceof Number) return ((Number) obj).doubleValue();
        if (obj instanceof String) {
            try { return Double.parseDouble(((String) obj).trim()); } catch (NumberFormatException ignored) {}
        }
        return def;
    }

    public static List<String> asStringList(Object obj) {
        List<String> out = new ArrayList<>();
        if (obj instanceof Collection) {
            for (Object item : (Collection<?>) obj) {
                if (item != null) {
                    String s = String.valueOf(item).trim();
                    if (!s.isEmpty()) out.add(s);
                }
            }
        }
        return out;
    }

    public static String stringify(Object value) {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, value);
        return sb.toString();
    }

    public static String quote(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private static void writeValue(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            sb.append(quote((String) value));
        } else if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
            sb.append(value.toString());
        } else if (value instanceof Number) {
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("0");
            } else {
                sb.append(value.toString());
            }
        } else if (value instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                sb.append(quote(String.valueOf(entry.getKey()))).append(':');
                writeValue(sb, entry.getValue());
            }
            sb.append('}');
        } else if (value instanceof Collection) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Collection<?>) value) {
                if (!first) sb.append(',');
                first = false;
                writeValue(sb, item);
            }
            sb.append(']');
        } else {
            sb.append(quote(String.valueOf(value)));
        }
    }

    private static final class Parser {
        private static final int MAX_DEPTH = 64;
        private final String s;
        private final int len;
        private int pos;
        private int depth;

        Parser(String s) {
            this.s = s;
            this.len = s.length();
        }

        boolean eof() {
            return pos >= len;
        }

        void skipWs() {
            while (pos < len && Character.isWhitespace(s.charAt(pos))) pos++;
        }

        Object readValue() {
            skipWs();
            if (eof()) return null;
            char c = s.charAt(pos);
            if (c == '{') return readObject();
            if (c == '[') return readArray();
            if (c == '"') return readString();
            if (c == 't' && s.startsWith("true", pos)) { pos += 4; return Boolean.TRUE; }
            if (c == 'f' && s.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            if (c == 'n' && s.startsWith("null", pos)) { pos += 4; return null; }
            return readNumber();
        }

        Map<String, Object> readObject() {
            if (++depth > MAX_DEPTH) {
                throw new IllegalArgumentException("JSON nesting depth exceeds maximum allowed limit");
            }
            try {
                Map<String, Object> map = new LinkedHashMap<>();
                pos++; // '{'
                while (!eof()) {
                    skipWs();
                    if (eof()) break;
                    if (s.charAt(pos) == '}') { pos++; break; }
                    if (s.charAt(pos) == ',') { pos++; continue; }
                    if (s.charAt(pos) != '"') break;
                    String key = readString();
                    skipWs();
                    if (eof() || s.charAt(pos) != ':') break;
                    pos++; // ':'
                    Object val = readValue();
                    map.put(key, val);
                    skipWs();
                    if (!eof() && s.charAt(pos) == ',') pos++;
                }
                return map;
            } finally {
                depth--;
            }
        }

        List<Object> readArray() {
            if (++depth > MAX_DEPTH) {
                throw new IllegalArgumentException("JSON nesting depth exceeds maximum allowed limit");
            }
            try {
                List<Object> list = new ArrayList<>();
                pos++; // '['
                while (!eof()) {
                    skipWs();
                    if (eof()) break;
                    if (s.charAt(pos) == ']') { pos++; break; }
                    if (s.charAt(pos) == ',') { pos++; continue; }
                    list.add(readValue());
                    skipWs();
                    if (!eof() && s.charAt(pos) == ',') pos++;
                }
                return list;
            } finally {
                depth--;
            }
        }

        String readString() {
            StringBuilder sb = new StringBuilder();
            pos++; // opening quote
            while (pos < len) {
                char c = s.charAt(pos++);
                if (c == '"') break;
                if (c == '\\' && pos < len) {
                    char esc = s.charAt(pos++);
                    switch (esc) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            if (pos + 4 <= len) {
                                try {
                                    sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                                    pos += 4;
                                } catch (NumberFormatException ignored) {}
                            }
                            break;
                        default: sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        Object readNumber() {
            int start = pos;
            while (pos < len) {
                char c = s.charAt(pos);
                if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') {
                    pos++;
                } else {
                    break;
                }
            }
            String raw = s.substring(start, pos);
            if (raw.isEmpty()) return null;
            try {
                if (raw.indexOf('.') >= 0 || raw.indexOf('e') >= 0 || raw.indexOf('E') >= 0) {
                    return Double.valueOf(Double.parseDouble(raw));
                }
                long lv = Long.parseLong(raw);
                if (lv >= Integer.MIN_VALUE && lv <= Integer.MAX_VALUE) {
                    return Integer.valueOf((int) lv);
                }
                return Long.valueOf(lv);
            } catch (NumberFormatException ex) {
                return raw;
            }
        }
    }
}
