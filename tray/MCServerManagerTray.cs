using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MCServerManagerTray
{
    public enum QuitChoice
    {
        Abort,
        StopAllAndExit,
        KillAllAndExit
    }

    public class RunningServerInfo
    {
        public string id { get; set; }
        public string name { get; set; }
        public string status { get; set; }
        public int playersOnline { get; set; }
    }

    public class RunningServersResponse
    {
        public int count { get; set; }
        public List<RunningServerInfo> servers { get; set; }
    }

    internal sealed class DarkMenuColorTable : ProfessionalColorTable
    {
        private static readonly Color Bg = Color.FromArgb(0x2c, 0x2e, 0x2d);
        private static readonly Color Hover = Color.FromArgb(0x24, 0x70, 0x83);
        private static readonly Color Border = Color.FromArgb(0x37, 0xab, 0xc8);

        public override Color ToolStripDropDownBackground { get { return Bg; } }
        public override Color ImageMarginGradientBegin { get { return Bg; } }
        public override Color ImageMarginGradientMiddle { get { return Bg; } }
        public override Color ImageMarginGradientEnd { get { return Bg; } }
        public override Color MenuBorder { get { return Border; } }
        public override Color MenuItemBorder { get { return Border; } }
        public override Color MenuItemSelected { get { return Hover; } }
        public override Color MenuItemSelectedGradientBegin { get { return Hover; } }
        public override Color MenuItemSelectedGradientEnd { get { return Hover; } }
        public override Color SeparatorDark { get { return Color.FromArgb(0x44, 0x49, 0x47); } }
        public override Color SeparatorLight { get { return Bg; } }
        public override Color CheckBackground { get { return Hover; } }
        public override Color CheckPressedBackground { get { return Border; } }
        public override Color CheckSelectedBackground { get { return Border; } }
    }

    /// <summary>
    /// Native modal MessageBox-style dialog displayed when quitting while one or more Minecraft servers are running.
    /// Offers the exact 3 options: Stop all servers and exit, Kill all servers and exit, Abort.
    /// </summary>
    internal sealed class RunningServersDialog : Form
    {
        public QuitChoice Choice { get; private set; }

        public RunningServersDialog(List<RunningServerInfo> runningServers, Icon appIcon)
        {
            Choice = QuitChoice.Abort;
            Text = "MCServerManager — Server Running";
            Icon = appIcon;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            ShowInTaskbar = true;
            BackColor = Color.FromArgb(0x1a, 0x1a, 0x1a);
            ForeColor = Color.FromArgb(0xed, 0xf3, 0xf4);
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(540, 225);

            var topPanel = new Panel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(18, 16, 18, 10),
                BackColor = Color.FromArgb(0x1a, 0x1a, 0x1a)
            };

            var iconBox = new PictureBox
            {
                Image = SystemIcons.Warning.ToBitmap(),
                SizeMode = PictureBoxSizeMode.AutoSize,
                Location = new Point(18, 18)
            };

            var count = runningServers != null ? runningServers.Count : 1;
            var heading = new Label
            {
                Text = count == 1
                    ? "A Minecraft server is currently running."
                    : string.Format("{0} Minecraft servers are currently running.", count),
                Font = new Font("Segoe UI", 11f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0x37, 0xab, 0xc8),
                Location = new Point(66, 16),
                Size = new Size(455, 24)
            };

            var sb = new StringBuilder();
            sb.AppendLine("Quitting MCServerManager now will also terminate running Minecraft server(s):");
            if (runningServers != null)
            {
                int shown = 0;
                foreach (var s in runningServers)
                {
                    if (shown >= 4)
                    {
                        sb.AppendFormat("  • and {0} more...", runningServers.Count - shown);
                        break;
                    }
                    sb.AppendFormat("  • {0} ({1}, {2} player{3})\r\n",
                        string.IsNullOrEmpty(s.name) ? s.id : s.name,
                        string.IsNullOrEmpty(s.status) ? "running" : s.status,
                        s.playersOnline,
                        s.playersOnline == 1 ? "" : "s");
                    shown++;
                }
            }
            sb.AppendLine();
            sb.Append("Choose how you want to exit:");

            var message = new Label
            {
                Text = sb.ToString(),
                Location = new Point(66, 46),
                Size = new Size(455, 105),
                ForeColor = Color.FromArgb(0xd7, 0xe3, 0xe6)
            };

            topPanel.Controls.Add(iconBox);
            topPanel.Controls.Add(heading);
            topPanel.Controls.Add(message);

            var btnPanel = new FlowLayoutPanel
            {
                Dock = DockStyle.Bottom,
                Height = 58,
                FlowDirection = FlowDirection.RightToLeft,
                Padding = new Padding(14, 12, 14, 12),
                BackColor = Color.FromArgb(0x2c, 0x2e, 0x2d)
            };

            var abortBtn = MakeButton("Abort", Color.FromArgb(0x3a, 0x3f, 0x3d), Color.FromArgb(0xed, 0xf3, 0xf4), 92);
            abortBtn.Click += (s, e) => { Choice = QuitChoice.Abort; DialogResult = DialogResult.Cancel; Close(); };

            var killBtn = MakeButton("Kill all servers and exit", Color.FromArgb(0x8f, 0x28, 0x28), Color.White, 178);
            killBtn.Click += (s, e) => { Choice = QuitChoice.KillAllAndExit; DialogResult = DialogResult.No; Close(); };

            var stopBtn = MakeButton("Stop all servers and exit", Color.FromArgb(0x2c, 0x89, 0xa0), Color.White, 192);
            stopBtn.Click += (s, e) => { Choice = QuitChoice.StopAllAndExit; DialogResult = DialogResult.Yes; Close(); };

            btnPanel.Controls.Add(abortBtn);
            btnPanel.Controls.Add(killBtn);
            btnPanel.Controls.Add(stopBtn);

            AcceptButton = stopBtn;
            CancelButton = abortBtn;

            Controls.Add(topPanel);
            Controls.Add(btnPanel);
        }

        private static Button MakeButton(string text, Color bg, Color fg, int width)
        {
            var btn = new Button
            {
                Text = text,
                Width = width,
                Height = 34,
                FlatStyle = FlatStyle.Flat,
                BackColor = bg,
                ForeColor = fg,
                Cursor = Cursors.Hand,
                Margin = new Padding(6, 0, 0, 0)
            };
            btn.FlatAppearance.BorderColor = Color.FromArgb(0x37, 0xab, 0xc8);
            btn.FlatAppearance.BorderSize = 1;
            return btn;
        }
    }

    public sealed class ConsoleTrayForm : Form
    {
        private const string StartupRunRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string StartupRunValueName = "MCServerManager";

        private readonly string projectRoot;
        private readonly int port;
        private readonly string traySecret;
        private readonly bool startMinimized;
        private readonly Icon appIcon;
        private readonly NotifyIcon trayIcon;
        private readonly RichTextBox consoleBox;
        private readonly Label statusLabel;
        private readonly CheckBox autoStartCheckBox;
        private readonly ToolStripMenuItem trayAutoStartItem;
        private readonly EventWaitHandle showEvent;

        private Process nodeProcess;
        private volatile bool isExiting;
        private volatile bool exitPromptActive;
        private bool shownTrayTip;
        private bool updatingAutoStartUi;
        private bool isInitialized;

        public ConsoleTrayForm(string projectRoot, int port, EventWaitHandle showEvent, bool startMinimized = false)
        {
            this.projectRoot = projectRoot;
            this.port = port;
            this.traySecret = GenerateTraySecret();
            this.showEvent = showEvent;
            this.startMinimized = startMinimized;

            // Load embedded EXE icon or assets/icon.ico
            string icoPath = Path.Combine(projectRoot, "assets", "icon.ico");
            if (File.Exists(icoPath))
            {
                appIcon = new Icon(icoPath);
            }
            else
            {
                appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            }

            // Configure Console Window
            Text = "MCServerManager — Console";
            Icon = appIcon;
            Size = new Size(920, 560);
            MinimumSize = new Size(640, 360);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(0x1a, 0x1a, 0x1a);
            ForeColor = Color.FromArgb(0xed, 0xf3, 0xf4);

            // Top Toolbar
            var toolbar = new Panel
            {
                Dock = DockStyle.Top,
                Height = 48,
                BackColor = Color.FromArgb(0x2c, 0x2e, 0x2d),
                Padding = new Padding(12, 8, 12, 8)
            };

            statusLabel = new Label
            {
                Text = string.Format("MCServerManager  •  http://localhost:{0}", port),
                AutoSize = true,
                Location = new Point(14, 14),
                Font = new Font("Segoe UI", 10f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0x37, 0xab, 0xc8)
            };

            var btnFlow = new FlowLayoutPanel
            {
                Dock = DockStyle.Right,
                AutoSize = true,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                BackColor = Color.Transparent
            };

            var openWebBtn = CreateToolbarButton("Open Web Panel", Color.FromArgb(0x2c, 0x89, 0xa0));
            openWebBtn.Click += (s, e) => OpenWebPanel();

            var clearBtn = CreateToolbarButton("Clear", Color.FromArgb(0x1a, 0x1a, 0x1a));
            clearBtn.Click += (s, e) => consoleBox.Clear();

            var trayBtn = CreateToolbarButton("Minimize to Tray", Color.FromArgb(0x24, 0x70, 0x83));
            trayBtn.Click += (s, e) => MinimizeToTray();

            btnFlow.Controls.Add(openWebBtn);
            btnFlow.Controls.Add(clearBtn);
            btnFlow.Controls.Add(trayBtn);

            toolbar.Controls.Add(statusLabel);
            toolbar.Controls.Add(btnFlow);

            // Console Output Box
            consoleBox = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BorderStyle = BorderStyle.None,
                BackColor = Color.FromArgb(0x14, 0x16, 0x16),
                ForeColor = Color.FromArgb(0xd8, 0xe5, 0xe8),
                Font = new Font("Consolas", 9.75f),
                WordWrap = true,
                DetectUrls = true
            };
            consoleBox.LinkClicked += (s, e) =>
            {
                try
                {
                    Uri uri;
                    if (Uri.TryCreate(e.LinkText, UriKind.Absolute, out uri) &&
                        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = uri.AbsoluteUri,
                            UseShellExecute = true
                        });
                    }
                }
                catch { }
            };

            // Bottom Options Bar
            var bottomBar = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 36,
                BackColor = Color.FromArgb(0x2c, 0x2e, 0x2d),
                Padding = new Padding(14, 6, 14, 6)
            };

            bool autoStartEnabled = IsAutoStartEnabled();
            autoStartCheckBox = new CheckBox
            {
                Text = "Start with Windows (minimized to tray)",
                Checked = autoStartEnabled,
                AutoSize = true,
                Location = new Point(14, 9),
                BackColor = Color.Transparent,
                ForeColor = Color.FromArgb(0xd8, 0xe5, 0xe8),
                Font = new Font("Segoe UI", 9f),
                Cursor = Cursors.Hand
            };
            autoStartCheckBox.CheckedChanged += (s, e) =>
            {
                if (!updatingAutoStartUi)
                {
                    ApplyAutoStartSetting(autoStartCheckBox.Checked);
                }
            };
            bottomBar.Controls.Add(autoStartCheckBox);

            Controls.Add(consoleBox);
            Controls.Add(bottomBar);
            Controls.Add(toolbar);

            // Tray Context Menu (Right-click)
            var trayMenu = new ContextMenuStrip
            {
                Renderer = new ToolStripProfessionalRenderer(new DarkMenuColorTable()),
                ForeColor = Color.FromArgb(0xed, 0xf3, 0xf4),
                ShowImageMargin = false,
                ShowCheckMargin = true
            };

            var showItem = new ToolStripMenuItem("Show Console")
            {
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                ForeColor = Color.FromArgb(0x37, 0xab, 0xc8)
            };
            showItem.Click += (s, e) => ShowConsole();

            var openItem = new ToolStripMenuItem("Open Web Panel")
            {
                ForeColor = Color.FromArgb(0xed, 0xf3, 0xf4)
            };
            openItem.Click += (s, e) => OpenWebPanel();

            trayAutoStartItem = new ToolStripMenuItem("Start with Windows (minimized)")
            {
                ForeColor = Color.FromArgb(0xed, 0xf3, 0xf4),
                CheckOnClick = true,
                Checked = autoStartEnabled
            };
            trayAutoStartItem.CheckedChanged += (s, e) =>
            {
                if (!updatingAutoStartUi)
                {
                    ApplyAutoStartSetting(trayAutoStartItem.Checked);
                }
            };

            var exitItem = new ToolStripMenuItem("Exit")
            {
                ForeColor = Color.FromArgb(0xf8, 0x71, 0x71)
            };
            exitItem.Click += (s, e) => RequestExit();

            trayMenu.Items.Add(showItem);
            trayMenu.Items.Add(openItem);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(trayAutoStartItem);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(exitItem);

            // System Tray NotifyIcon
            trayIcon = new NotifyIcon
            {
                Icon = appIcon,
                Text = "MCServerManager",
                ContextMenuStrip = trayMenu,
                Visible = true
            };

            // Left-click tray icon -> Show Console
            trayIcon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    ShowConsole();
                }
            };

            // Minimize -> Hide to System Tray
            Resize += (s, e) =>
            {
                if (isInitialized && WindowState == FormWindowState.Minimized)
                {
                    MinimizeToTray(false);
                }
            };

            // Window Close (X) -> Run the same quit check (with running-server confirmation dialog)
            FormClosing += (s, e) =>
            {
                if (!isExiting && e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    RequestExit();
                }
            };

            if (startMinimized)
            {
                WindowState = FormWindowState.Minimized;
                ShowInTaskbar = false;
                Opacity = 0;
            }

            Load += (s, e) =>
            {
                StartShowSignalListener();
                StartNodeBackend();
                isInitialized = true;
            };

            Shown += (s, e) =>
            {
                if (this.startMinimized)
                {
                    MinimizeToTray(true);
                    Opacity = 1;
                }
            };
        }

        private static bool IsAutoStartEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(StartupRunRegistryPath, false))
                {
                    if (key == null) return false;
                    var val = key.GetValue(StartupRunValueName) as string;
                    return !string.IsNullOrWhiteSpace(val);
                }
            }
            catch
            {
                return false;
            }
        }

        private void ApplyAutoStartSetting(bool enable)
        {
            bool finalState = IsAutoStartEnabled();
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(StartupRunRegistryPath, true))
                {
                    if (key == null)
                    {
                        throw new InvalidOperationException("Windows Run registry key is not accessible.");
                    }

                    if (enable)
                    {
                        string cmd = "\"" + Application.ExecutablePath + "\" --minimized";
                        key.SetValue(StartupRunValueName, cmd, RegistryValueKind.String);
                        finalState = true;
                        AppendLog("[MCServerManager] Enabled auto-start with Windows (minimized to tray).", Color.FromArgb(0x37, 0xab, 0xc8));
                    }
                    else
                    {
                        key.DeleteValue(StartupRunValueName, false);
                        finalState = false;
                        AppendLog("[MCServerManager] Disabled auto-start with Windows.", Color.FromArgb(0x37, 0xab, 0xc8));
                    }
                }
            }
            catch (Exception ex)
            {
                AppendLog("[MCServerManager] Could not update Windows startup setting: " + ex.Message, Color.FromArgb(0xf8, 0x71, 0x71));
            }

            updatingAutoStartUi = true;
            try
            {
                autoStartCheckBox.Checked = finalState;
                trayAutoStartItem.Checked = finalState;
            }
            finally
            {
                updatingAutoStartUi = false;
            }
        }

        private static Button CreateToolbarButton(string text, Color bg)
        {
            var b = new Button
            {
                Text = text,
                AutoSize = true,
                Height = 30,
                Padding = new Padding(8, 0, 8, 0),
                Margin = new Padding(6, 0, 0, 0),
                FlatStyle = FlatStyle.Flat,
                BackColor = bg,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                Cursor = Cursors.Hand
            };
            b.FlatAppearance.BorderColor = Color.FromArgb(0x37, 0xab, 0xc8);
            b.FlatAppearance.BorderSize = 1;
            return b;
        }

        private void StartShowSignalListener()
        {
            var thread = new Thread(() =>
            {
                while (!isExiting)
                {
                    try
                    {
                        if (showEvent.WaitOne(500) && !isExiting)
                        {
                            BeginInvoke((Action)ShowConsole);
                        }
                    }
                    catch
                    {
                        break;
                    }
                }
            }) { IsBackground = true };
            thread.Start();
        }

        private void OpenWebPanel()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = string.Format("http://localhost:{0}", port),
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                AppendLog("[Tray] Could not open browser: " + ex.Message, Color.FromArgb(0xf8, 0x71, 0x71));
            }
        }

        public void MinimizeToTray(bool silent = false)
        {
            Hide();
            ShowInTaskbar = false;
            if (!silent && !shownTrayTip)
            {
                shownTrayTip = true;
                trayIcon.ShowBalloonTip(
                    2500,
                    "MCServerManager",
                    "Minimized to system tray. Left-click to show console, right-click for menu.",
                    ToolTipIcon.Info);
            }
        }

        public void ShowConsole()
        {
            Opacity = 1;
            Show();
            ShowInTaskbar = true;
            if (WindowState == FormWindowState.Minimized)
            {
                WindowState = FormWindowState.Normal;
            }
            Activate();
            BringToFront();
        }

        private void AppendLog(string line, Color? color = null)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke((Action)(() => AppendLog(line, color))); } catch { }
                return;
            }
            Color c = color ?? Color.FromArgb(0xd8, 0xe5, 0xe8);
            if (color == null)
            {
                if (line.IndexOf("error", StringComparison.OrdinalIgnoreCase) >= 0)
                    c = Color.FromArgb(0xfc, 0xa5, 0xa5);
                else if (line.IndexOf("warn", StringComparison.OrdinalIgnoreCase) >= 0)
                    c = Color.FromArgb(0xfc, 0xd3, 0x4d);
                else if (line.IndexOf("[MCServerManager]", StringComparison.OrdinalIgnoreCase) >= 0 ||
                         line.IndexOf("MCServerManager running", StringComparison.OrdinalIgnoreCase) >= 0)
                    c = Color.FromArgb(0x37, 0xab, 0xc8);
            }

            if (consoleBox.TextLength > 180000)
            {
                consoleBox.Select(0, 60000);
                consoleBox.SelectedText = "";
            }
            consoleBox.SelectionStart = consoleBox.TextLength;
            consoleBox.SelectionLength = 0;
            consoleBox.SelectionColor = c;
            consoleBox.AppendText(line + Environment.NewLine);
            consoleBox.ScrollToCaret();
        }

        private static string GenerateTraySecret()
        {
            byte[] bytes = new byte[24];
            using (var rng = new RNGCryptoServiceProvider())
            {
                rng.GetBytes(bytes);
            }
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes)
            {
                sb.AppendFormat("{0:x2}", b);
            }
            return sb.ToString();
        }

        private string ResolveNodePath()
        {
            string defaultWin = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(defaultWin)) return defaultWin;
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                string candidate = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            return "node.exe";
        }

        private void StartNodeBackend()
        {
            string entryJs = Path.Combine(projectRoot, "server", "dist", "server", "src", "index.js");
            if (!File.Exists(entryJs))
            {
                AppendLog("[MCServerManager] Compiled server not found at: " + entryJs, Color.FromArgb(0xf8, 0x71, 0x71));
                AppendLog("[MCServerManager] Run 'npm.cmd run build' first.", Color.FromArgb(0xfb, 0xbf, 0x24));
                return;
            }

            string nodeExe = ResolveNodePath();
            AppendLog("[MCServerManager] Starting backend using " + nodeExe, Color.FromArgb(0x37, 0xab, 0xc8));

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + entryJs + "\"",
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            psi.EnvironmentVariables["PORT"] = port.ToString();
            psi.EnvironmentVariables["MCSM_TRAY_SECRET"] = traySecret;

            try
            {
                nodeProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
                nodeProcess.OutputDataReceived += (s, e) => { if (e.Data != null) AppendLog(e.Data); };
                nodeProcess.ErrorDataReceived += (s, e) => { if (e.Data != null) AppendLog(e.Data, Color.FromArgb(0xfc, 0xa5, 0xa5)); };
                nodeProcess.Exited += (s, e) =>
                {
                    if (!isExiting)
                    {
                        AppendLog(string.Format("[MCServerManager] Backend process exited (code {0}).", nodeProcess.ExitCode), Color.FromArgb(0xfb, 0xbf, 0x24));
                    }
                };
                nodeProcess.Start();
                nodeProcess.BeginOutputReadLine();
                nodeProcess.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLog("[MCServerManager] Failed to launch Node.js backend: " + ex.Message, Color.FromArgb(0xf8, 0x71, 0x71));
            }
        }

        private RunningServersResponse QueryRunningServers()
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/system/running-servers", port));
                req.Method = "GET";
                req.Headers["X-Tray-Secret"] = traySecret;
                req.Timeout = 2000;
                req.ReadWriteTimeout = 2000;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    string json = reader.ReadToEnd();
                    var ser = new JavaScriptSerializer();
                    return ser.Deserialize<RunningServersResponse>(json);
                }
            }
            catch
            {
                return null;
            }
        }

        private bool SendShutdownRequest(string mode, int timeoutMs)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/system/shutdown", port));
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Headers["X-Tray-Secret"] = traySecret;
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                byte[] body = Encoding.UTF8.GetBytes("{\"mode\":\"" + mode + "\"}");
                req.ContentLength = body.Length;
                using (var stream = req.GetRequestStream())
                {
                    stream.Write(body, 0, body.Length);
                }
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void RequestExit()
        {
            if (isExiting || exitPromptActive) return;
            exitPromptActive = true;

            try
            {
                var running = QueryRunningServers();
                string shutdownMode = "stop";

                if (running != null && running.count > 0)
                {
                    using (var dlg = new RunningServersDialog(running.servers, appIcon))
                    {
                        dlg.ShowDialog();
                        if (dlg.Choice == QuitChoice.Abort)
                        {
                            exitPromptActive = false;
                            return;
                        }
                        shutdownMode = dlg.Choice == QuitChoice.KillAllAndExit ? "kill" : "stop";
                    }
                }

                isExiting = true;
                trayIcon.Text = "MCServerManager — Shutting down...";
                AppendLog(
                    shutdownMode == "kill"
                        ? "[MCServerManager] Killing all running Minecraft servers and exiting..."
                        : "[MCServerManager] Gracefully stopping all running Minecraft servers and exiting...",
                    Color.FromArgb(0xfb, 0xbf, 0x24));

                Task.Run(() =>
                {
                    try
                    {
                        SendShutdownRequest(shutdownMode, shutdownMode == "kill" ? 5000 : 30000);
                        if (nodeProcess != null && !nodeProcess.HasExited)
                        {
                            if (!nodeProcess.WaitForExit(shutdownMode == "kill" ? 2000 : 8000))
                            {
                                try { nodeProcess.Kill(); } catch { }
                            }
                        }
                    }
                    finally
                    {
                        try
                        {
                            BeginInvoke((Action)(() =>
                            {
                                trayIcon.Visible = false;
                                trayIcon.Dispose();
                                Application.Exit();
                            }));
                        }
                        catch
                        {
                            Environment.Exit(0);
                        }
                    }
                });
            }
            catch
            {
                exitPromptActive = false;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }
                if (appIcon != null) appIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string projectRoot = FindProjectRoot(exeDir);

            // Optional test flag to preview the running-server exit MessageBox directly
            foreach (var a in args)
            {
                if (string.Equals(a, "--test-exit-dialog", StringComparison.OrdinalIgnoreCase))
                {
                    string icoPath = Path.Combine(projectRoot, "assets", "icon.ico");
                    Icon ico = File.Exists(icoPath) ? new Icon(icoPath) : SystemIcons.Application;
                    var sample = new List<RunningServerInfo>
                    {
                        new RunningServerInfo { id = "survival", name = "Survival SMP", status = "online", playersOnline = 2 }
                    };
                    using (var dlg = new RunningServersDialog(sample, ico))
                    {
                        dlg.ShowDialog();
                        Console.WriteLine("Selected: " + dlg.Choice);
                    }
                    return;
                }
            }

            bool createdNew;
            using (var mutex = new Mutex(true, "MCServerManager_SingleInstance_Mutex", out createdNew))
            using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "MCServerManager_ShowConsole_Event"))
            {
                if (!createdNew)
                {
                    // Signal existing instance to bring its console window forward
                    showEvent.Set();
                    return;
                }

                int port = 3001;
                string portEnv = Environment.GetEnvironmentVariable("PORT");
                int parsedPort;
                if (!string.IsNullOrEmpty(portEnv) && int.TryParse(portEnv, out parsedPort))
                {
                    port = parsedPort;
                }

                bool startMinimized = false;
                foreach (var a in args)
                {
                    if (string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase))
                        startMinimized = true;
                }

                var form = new ConsoleTrayForm(projectRoot, port, showEvent, startMinimized);
                Application.Run(form);
            }
        }

        private static string FindProjectRoot(string startDir)
        {
            string dir = startDir;
            for (int i = 0; i < 6; i++)
            {
                if (File.Exists(Path.Combine(dir, "package.json")) && Directory.Exists(Path.Combine(dir, "server")))
                    return dir;
                var parent = Directory.GetParent(dir);
                if (parent == null) break;
                dir = parent.FullName;
            }
            return startDir;
        }
    }
}
