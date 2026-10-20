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
using VDF.Core.Utils;

namespace VDF.CLI.Commands {
	internal static class ExifCommand {
		internal static Command Build() {
			var cmd = new Command("exif",
				"Read the capture date of each file listed in --paths and write {path: UTC date} as JSON. Files without a date are left out.");

			var pathsOpt = new Option<FileInfo>("--paths") {
				Description = "Text file with one media file path per line.",
				Required = true,
			};
			var outputOpt = new Option<FileInfo>("--output", "-o") {
				Description = "Path for the JSON file.",
				Required = true,
			};
			cmd.Options.Add(pathsOpt);
			cmd.Options.Add(outputOpt);
			cmd.Options.Add(SharedOptions.Parallelism);

			cmd.SetAction((parseResult, ct) => {
				var pathsFile = parseResult.GetValue(pathsOpt)!;
				var outputFile = parseResult.GetValue(outputOpt)!;
				int parallelism = Math.Max(1, parseResult.GetValue(SharedOptions.Parallelism));
				if (!pathsFile.Exists) {
					Console.Error.WriteLine($"Error: {pathsFile.FullName} does not exist.");
					return Task.FromResult(1);
				}
				string[] paths = File.ReadAllLines(pathsFile.FullName)
					.Select(line => line.Trim())
					.Where(line => line.Length > 0)
					.Distinct(StringComparer.Ordinal)
					.ToArray();
				Dictionary<string, DateTime> found = CaptureTimeReader.ReadMany(paths, parallelism, ct);
				CaptureTimeReader.WriteJson(outputFile.FullName, found);
				Console.Error.WriteLine($"Capture dates found for {found.Count:N0} of {paths.Length:N0} files.");
				return Task.FromResult(0);
			});

			return cmd;
		}
	}
}
