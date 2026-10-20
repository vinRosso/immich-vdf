using VDF.Core;
using VDF.Core.Utils;
using Xunit;

namespace VDF.ForkTests;

/// <summary>
/// Runs the engine's own compare over a small synthetic database, more than once, and checks that
/// the saved pair scores never change what a later compare reports.
/// </summary>
public sealed class CompareRerunTests : IDisposable {
	readonly string folder = Path.Combine(Path.GetTempPath(), "vdf-rerun-" + Guid.NewGuid().ToString("N"));
	readonly DateTime day = TimeWindow.Epoch.AddDays(100);

	public CompareRerunTests() {
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

	static byte[] Noise(int seed) {
		var bytes = new byte[1024];
		new Random(seed).NextBytes(bytes);
		return bytes;
	}

	/// <summary>Low-frequency pattern, so a small change leaves the perceptual hash alone.</summary>
	static byte[] Smooth(int seed) {
		var bytes = new byte[1024];
		for (int y = 0; y < 32; y++)
			for (int x = 0; x < 32; x++)
				bytes[(y * 32) + x] = (byte)(128 + (90 * Math.Sin((0.31 * (seed + 1) * x) + (0.17 * (seed + 2) * y) + seed)));
		return bytes;
	}

	static byte[] Perturb(byte[] source, int amplitude, int seed) {
		var random = new Random(seed);
		var copy = new byte[source.Length];
		for (int i = 0; i < source.Length; i++)
			copy[i] = (byte)Math.Clamp(source[i] + random.Next(-amplitude, amplitude + 1), 0, 255);
		return copy;
	}

	static byte[] Mirror(byte[] source) {
		var copy = new byte[source.Length];
		for (int y = 0; y < 32; y++)
			for (int x = 0; x < 32; x++)
				copy[(y * 32) + x] = source[(y * 32) + (31 - x)];
		return copy;
	}

	FileEntry Image(string name, byte[] gray) {
		var entry = new FileEntry {
			Path = Path.Combine(folder, name),
			DateCreated = day,
			DateModified = day,
			FileSize = 1000 + name.Length,
		};
		entry.IsImage = true;
		entry.mediaInfo = new MediaInfo { Streams = new[] { new MediaInfo.StreamInfo { Width = 100, Height = 100 } } };
		entry.grayBytes[0] = gray;
		entry.invalid = false;
		DatabaseUtils.Database.Add(entry);
		return entry;
	}

	FileEntry Video(string name, byte[] gray, double seconds) {
		var entry = new FileEntry {
			Path = Path.Combine(folder, name),
			DateCreated = day,
			DateModified = day,
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

	static Settings Match(float percent, Action<Settings>? tweak = null) {
		var settings = new Settings { Percent = percent, ThumbnailCount = 1 };
		tweak?.Invoke(settings);
		return settings;
	}

	/// <summary>One compare, the way the CLI runs it: pair scores are read from and written to the database folder.</summary>
	string[] Compare(Settings settings, IReadOnlyDictionary<string, DateTime>? captureTimes = null) {
		var engine = new ScanEngine { Settings = settings, CaptureTimeOverrides = captureTimes };
		engine.positionList.Clear();
		engine.positionList.Add(0.5f);
		engine.ScanForDuplicates();
		return engine.Duplicates
			.GroupBy(item => item.GroupId)
			.Select(group => string.Join(" + ", group
				.OrderBy(item => item.Path, StringComparer.Ordinal)
				.Select(item => Path.GetFileName(item.Path) + (item.Flags == DuplicateFlags.None ? "" : $"[{item.Flags}]"))))
			.OrderBy(text => text, StringComparer.Ordinal)
			.ToArray();
	}

	string StoreFile => Path.Combine(folder, "PairScores.db");

	void LibraryOfImages() {
		byte[] a = Noise(1);
		Image("a1.jpg", a);
		Image("a2.jpg", Perturb(a, 2, 11));
		byte[] b = Noise(2);
		Image("b1.jpg", b);
		Image("b2.jpg", Perturb(b, 40, 12));
		byte[] d = Noise(3);
		Image("d1.jpg", d);
		Image("d2.jpg", Perturb(Mirror(d), 1, 13));
		Image("u1.jpg", Noise(4));
	}

	[Fact]
	public void ASecondCompareReportsTheSameGroupsIncludingTheMirrorFlag() {
		LibraryOfImages();
		Settings flipped() => Match(96, s => s.CompareHorizontallyFlipped = true);

		string[] first = Compare(flipped());
		Assert.True(File.Exists(StoreFile));
		Assert.Equal(2, first.Length);
		Assert.Contains("a1.jpg + a2.jpg", first);
		Assert.Contains(first, text => text.StartsWith("d1.jpg") && text.Contains("[Flipped]"));

		Assert.Equal(first, Compare(flipped()));
		Assert.Equal(first, Compare(flipped()));
	}

	[Fact]
	public void LoweringThePercentUsesTheStoredScoresAndMatchesAFullCompare() {
		LibraryOfImages();
		Settings strict() => Match(96, s => s.CompareHorizontallyFlipped = true);
		Settings loose() => Match(90, s => s.CompareHorizontallyFlipped = true);

		string[] atNinetySix = Compare(strict());
		Assert.DoesNotContain(atNinetySix, text => text.Contains("b1.jpg"));

		string[] atNinety = Compare(loose());
		Assert.Contains("b1.jpg + b2.jpg", atNinety);

		File.Delete(StoreFile);
		Assert.Equal(Compare(loose()), atNinety);
		Assert.Equal(atNinetySix, Compare(strict()));
	}

	[Fact]
	public void APercentBelowTheFloorDoesNotKeepStaleScores() {
		LibraryOfImages();
		string[] atEighty = Compare(Match(80));
		Assert.Contains("b1.jpg + b2.jpg", atEighty);
		Assert.Equal(atEighty, Compare(Match(80)));
		Assert.Equal(Compare(Match(96)), Compare(Match(96)));
	}

	[Fact]
	public void AChangedFileIsComparedAgain() {
		byte[] a = Noise(1);
		Image("a1.jpg", a);
		FileEntry second = Image("a2.jpg", Perturb(a, 2, 11));
		Image("u1.jpg", Noise(4));

		Assert.Equal(new[] { "a1.jpg + a2.jpg" }, Compare(Match(96)));

		second.grayBytes[0] = Noise(5);
		second.DateModified = second.DateModified.AddMinutes(3);
		Assert.Empty(Compare(Match(96)));

		second.grayBytes[0] = Perturb(a, 3, 14);
		second.DateModified = second.DateModified.AddMinutes(3);
		Assert.Equal(new[] { "a1.jpg + a2.jpg" }, Compare(Match(96)));
	}

	[Fact]
	public void ALoosenedDurationGateFindsThePairItSkippedBefore() {
		byte[] pattern = Noise(6);
		Video("short.mp4", pattern, 10);
		Video("long.mp4", Perturb(pattern, 1, 15), 14);

		Assert.Empty(Compare(Match(96)));
		Assert.Empty(Compare(Match(96)));

		string[] loosened = Compare(Match(96, s => s.PercentDurationDifference = 60));
		Assert.Equal(new[] { "long.mp4 + short.mp4" }, loosened);
	}

	[Fact]
	public void ASecondPHashCompareKeepsItsMatches() {
		byte[] pattern = Smooth(1);
		Video("v1.mp4", pattern, 10);
		Video("v2.mp4", Perturb(pattern, 1, 16), 10);
		Video("v3.mp4", Smooth(5), 10);
		Settings pHash() => Match(96, s => s.UsePHashing = true);

		string[] first = Compare(pHash());
		Assert.Single(first);
		Assert.Contains("v1.mp4", first[0]);
		Assert.Contains("v2.mp4", first[0]);

		Assert.Equal(first, Compare(pHash()));
		Assert.Equal(first, Compare(pHash()));
	}

	[Fact]
	public void ASecondCombinedCompareKeepsItsMatches() {
		byte[] pattern = Smooth(1);
		Video("v1.mp4", pattern, 10);
		Video("v2.mp4", Perturb(pattern, 1, 16), 10);
		Video("v3.mp4", Smooth(5), 10);
		Settings combined() => Match(96, s => s.CombineGrayscaleAndPHash = true);

		string[] first = Compare(combined());
		Assert.Single(first);
		Assert.Equal(first, Compare(combined()));
		Assert.Equal(first, Compare(combined()));
	}

	[Fact]
	public void SwitchingBetweenGrayAndPHashNeverCarriesScoresAcross() {
		byte[] pattern = Smooth(1);
		Video("v1.mp4", pattern, 10);
		Video("v2.mp4", Perturb(pattern, 1, 16), 10);
		Video("v3.mp4", Smooth(5), 10);

		string[] gray = Compare(Match(96));
		string[] pHash = Compare(Match(96, s => s.UsePHashing = true));
		Assert.Equal(gray, Compare(Match(96)));
		Assert.Equal(pHash, Compare(Match(96, s => s.UsePHashing = true)));
		Assert.Equal(gray.Length, pHash.Length);
	}

	[Fact]
	public void CaptureDatesDecideTheWindowAndLaterRunsAgree() {
		byte[] a = Noise(1);
		FileEntry first = Image("a1.jpg", a);
		FileEntry second = Image("a2.jpg", Perturb(a, 2, 11));
		Image("u1.jpg", Noise(4));
		Settings week() => Match(96, s => s.TimeWindowDays = 7);
		string[] together = { "a1.jpg + a2.jpg" };

		Assert.Equal(together, Compare(week()));

		// The file dates match, but the library says one was taken four months later.
		var apart = new Dictionary<string, DateTime> { [first.Path] = day, [second.Path] = day.AddDays(120) };
		Assert.Empty(Compare(week(), apart));
		Assert.Empty(Compare(week(), apart));

		var close = new Dictionary<string, DateTime> { [first.Path] = day, [second.Path] = day.AddDays(1) };
		Assert.Equal(together, Compare(week(), close));
		Assert.Equal(together, Compare(week(), close));

		// Without capture dates the file dates apply again, and nothing from the runs above leaks in.
		Assert.Equal(together, Compare(week()));
		Assert.All(DatabaseUtils.Database, entry => Assert.Null(entry.captureOverride));
	}

	[Fact]
	public void CaptureDatesStayOutOfTheSavedDatabase() {
		byte[] a = Noise(1);
		FileEntry first = Image("a1.jpg", a);
		Image("a2.jpg", Perturb(a, 2, 11));
		var edited = new Dictionary<string, DateTime> { [first.Path] = day.AddDays(40) };
		Compare(Match(96, s => s.TimeWindowDays = 7), edited);
		Assert.Equal(day, first.DateCreated);
	}
}
