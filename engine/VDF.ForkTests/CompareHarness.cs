using VDF.Core;
using VDF.Core.Utils;
using Xunit;

namespace VDF.ForkTests;

[CollectionDefinition("engine database", DisableParallelization = true)]
public sealed class EngineDatabaseCollection { }

/// <summary>
/// A synthetic scan database in a temporary folder, and a way to run the engine's own compare over it.
/// The database is process-wide state, so every class that uses it joins one collection and runs alone.
/// </summary>
[Collection("engine database")]
public abstract class CompareHarness : IDisposable {
	protected readonly string folder = Path.Combine(Path.GetTempPath(), "vdf-rerun-" + Guid.NewGuid().ToString("N"));
	protected readonly DateTime day = TimeWindow.Epoch.AddDays(100);

	protected CompareHarness() {
		Directory.CreateDirectory(folder);
		DatabaseUtils.CustomDatabaseFolder = folder;
		DatabaseUtils.InvalidateDatabaseFolder();
		DatabaseUtils.Database.Clear();
	}

	public void Dispose() {
		DatabaseUtils.Database.Clear();
		DatabaseUtils.CustomDatabaseFolder = null;
		DatabaseUtils.InvalidateDatabaseFolder();
		try { Directory.Delete(folder, recursive: true); } catch (IOException) { }
	}

	protected static byte[] Noise(int seed) {
		var bytes = new byte[1024];
		new Random(seed).NextBytes(bytes);
		return bytes;
	}

	/// <summary>Low-frequency pattern, so a small change leaves the perceptual hash alone.</summary>
	protected static byte[] Smooth(int seed) {
		var bytes = new byte[1024];
		for (int y = 0; y < 32; y++)
			for (int x = 0; x < 32; x++)
				bytes[(y * 32) + x] = (byte)(128 + (90 * Math.Sin((0.31 * (seed + 1) * x) + (0.17 * (seed + 2) * y) + seed)));
		return bytes;
	}

	protected static byte[] Perturb(byte[] source, int amplitude, int seed) {
		var random = new Random(seed);
		var copy = new byte[source.Length];
		for (int i = 0; i < source.Length; i++)
			copy[i] = (byte)Math.Clamp(source[i] + random.Next(-amplitude, amplitude + 1), 0, 255);
		return copy;
	}

	protected static byte[] Mirror(byte[] source) {
		var copy = new byte[source.Length];
		for (int y = 0; y < 32; y++)
			for (int x = 0; x < 32; x++)
				copy[(y * 32) + x] = source[(y * 32) + (31 - x)];
		return copy;
	}

	protected FileEntry Image(string name, byte[] gray, DateTime? created = null) {
		DateTime date = created ?? day;
		var entry = new FileEntry {
			Path = Path.Combine(folder, name),
			DateCreated = date,
			DateModified = date,
			FileSize = 1000 + name.Length,
		};
		entry.IsImage = true;
		entry.mediaInfo = new MediaInfo { Streams = new[] { new MediaInfo.StreamInfo { Width = 100, Height = 100 } } };
		entry.grayBytes[0] = gray;
		entry.invalid = false;
		DatabaseUtils.Database.Add(entry);
		return entry;
	}

	protected FileEntry Video(string name, byte[] gray, double seconds, DateTime? created = null) {
		DateTime date = created ?? day;
		var entry = new FileEntry {
			Path = Path.Combine(folder, name),
			DateCreated = date,
			DateModified = date,
			FileSize = 5000 + name.Length,
		};
		entry.mediaInfo = new MediaInfo {
			Duration = TimeSpan.FromSeconds(seconds),
			Streams = new[] { new MediaInfo.StreamInfo { Width = 320, Height = 240, CodecType = "video", CodecName = "h264" } },
		};
		entry.grayBytes[seconds * 0.5] = gray;
		entry.invalid = false;
		DatabaseUtils.Database.Add(entry);
		return entry;
	}

	protected static Settings Match(float percent, Action<Settings>? tweak = null) {
		var settings = new Settings { Percent = percent, ThumbnailCount = 1 };
		tweak?.Invoke(settings);
		return settings;
	}

	protected readonly record struct RunResult(string[] Groups, long Pairs);

	/// <summary>One compare, the way the CLI runs it: pair scores are read from and written to the database folder.</summary>
	protected string[] Compare(Settings settings, IReadOnlyDictionary<string, DateTime>? captureTimes = null) =>
		Run(settings, captureTimes).Groups;

	/// <summary>Like <see cref="Compare"/>, and also how many pairs the engine looked at.</summary>
	protected RunResult Run(Settings settings, IReadOnlyDictionary<string, DateTime>? captureTimes = null) {
		var engine = new ScanEngine { Settings = settings, CaptureTimeOverrides = captureTimes };
		engine.positionList.Clear();
		engine.positionList.Add(0.5f);
		engine.ScanForDuplicates();
		string[] groups = engine.Duplicates
			.GroupBy(item => item.GroupId)
			.Select(group => string.Join(" + ", group
				.OrderBy(item => item.Path, StringComparer.Ordinal)
				.Select(item => Path.GetFileName(item.Path) + (item.Flags == DuplicateFlags.None ? "" : $"[{item.Flags}]"))))
			.OrderBy(text => text, StringComparer.Ordinal)
			.ToArray();
		return new RunResult(groups, engine.PairsEvaluated);
	}

	protected string StoreFile => Path.Combine(folder, "PairScores.db");
}
