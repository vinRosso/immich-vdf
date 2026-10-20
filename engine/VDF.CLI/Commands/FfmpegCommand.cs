// /*
//     Copyright (C) 2026 0x90d
//     This file is part of VideoDuplicateFinder
//     VideoDuplicateFinder is free software: you can redistribute it and/or modify
//     it under the terms of the GNU Affero General Public License as published by
//     the Free Software Foundation, either version 3 of the License, or
//     (at your option) any later version.
//     VideoDuplicateFinder is distributed in the hope that it will be useful,
//     but WITHOUT ANY WARRANTY without even the implied warranty of
//     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//     GNU Affero General Public License for more details.
//     You should have received a copy of the GNU Affero General Public License
//     along with VideoDuplicateFinder.  If not, see <http://www.gnu.org/licenses/>.
// */
//

using System.CommandLine;
using System.Runtime.InteropServices;
using VDF.Core.FFTools;
using VDF.Core.FFTools.FFmpegNative;

namespace VDF.CLI.Commands {
	/// <summary>
	/// The FFmpeg shared libraries behind --native-ffmpeg. 'status' says whether they can be loaded, 'install' fetches
	/// the build that matches this binary with the engine's own downloader (checksum-checked, one build per OS and CPU).
	/// </summary>
	internal static class FfmpegCommand {
		internal static Command Build() {
			var cmd = new Command("ffmpeg", "Check for, or install, the FFmpeg shared libraries that make scans faster (--native-ffmpeg).");
			cmd.Subcommands.Add(BuildStatus());
			cmd.Subcommands.Add(BuildInstall());
			return cmd;
		}

		static Command BuildStatus() {
			var cmd = new Command("status", "Exit code 0 when the FFmpeg shared libraries are installed and can be loaded.");
			cmd.SetAction((parseResult, ct) => {
				bool available = FFmpegHelper.CanLoadNativeLibraries;
				Console.Error.WriteLine(available
					? "[scan] Native FFmpeg libraries are available."
					: $"[scan] Native FFmpeg libraries are not available. {FFmpegHelper.DescribeExpectedLibraries()}");
				return Task.FromResult(available ? 0 : 1);
			});
			return cmd;
		}

		static Command BuildInstall() {
			var cmd = new Command("install", "Download the FFmpeg shared libraries next to vdf-cli. Exit code 0 when they can be loaded afterwards.");
			cmd.SetAction(async (parseResult, ct) => {
				// The Linux build is a .tar.xz and is unpacked by the system tar, which needs the xz tool.
				// Finding that out after a 70 MB download is a waste, so ask first.
				if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux) && !IsOnPath("xz")) {
					Console.Error.WriteLine("[scan] FFmpeg could not be installed: unpacking the Linux download needs the 'xz' tool (package xz-utils).");
					return 1;
				}
				long lastReportedMegabytes = -1;
				var progress = new InlineProgress<FfmpegDownloadProgress>(p => {
					switch (p.Phase) {
						case FfmpegDownloadPhase.Downloading:
							// One line per 5 MB keeps the scan log readable. The "n/m MB" form is what the app's progress bar reads.
							long megabytes = p.BytesDone / (1024 * 1024);
							if (megabytes / 5 == lastReportedMegabytes / 5 && lastReportedMegabytes >= 0) return;
							lastReportedMegabytes = megabytes;
							Console.Error.WriteLine(p.BytesTotal is long total
								? $"[scan] Downloading FFmpeg... {megabytes}/{total / (1024 * 1024)} MB"
								: $"[scan] Downloading FFmpeg... {megabytes} MB");
							break;
						case FfmpegDownloadPhase.Verifying:
							Console.Error.WriteLine("[scan] Checking the FFmpeg download...");
							break;
						case FfmpegDownloadPhase.Extracting:
							Console.Error.WriteLine("[scan] Installing the FFmpeg libraries...");
							break;
					}
				});
				try {
					string folder = await FfmpegDownloader.DownloadAndInstallAsync(progress, ct);
					Console.Error.WriteLine($"[scan] FFmpeg installed in {folder}");
				}
				catch (Exception ex) when (ex is not OperationCanceledException) {
					Console.Error.WriteLine($"[scan] FFmpeg could not be installed: {ex.Message}");
					return 1;
				}
				bool available = FFmpegHelper.CanLoadNativeLibraries;
				Console.Error.WriteLine(available
					? "[scan] Native FFmpeg libraries are available."
					: $"[scan] The FFmpeg download did not give loadable libraries. {FFmpegHelper.DescribeExpectedLibraries()}");
				return available ? 0 : 1;
			});
			return cmd;
		}

		static bool IsOnPath(string tool) {
			string? path = Environment.GetEnvironmentVariable("PATH");
			if (string.IsNullOrEmpty(path)) return false;
			foreach (string folder in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)) {
				try {
					if (File.Exists(Path.Combine(folder, tool))) return true;
				}
				catch (ArgumentException) { /* a malformed PATH entry */ }
			}
			return false;
		}

		/// <summary>Reports on the calling thread. Progress&lt;T&gt; posts to the pool, which puts lines out of order with the lines after them.</summary>
		sealed class InlineProgress<T>(Action<T> report) : IProgress<T> {
			public void Report(T value) => report(value);
		}
	}
}
