using VDF.Core;
using Xunit;

namespace VDF.ForkTests;

public class ForkTests {
	static FileEntry Entry(string name, DateTime created, long size = 10) {
		var entry = new FileEntry {
			Path = Path.Combine(Path.GetTempPath(), "vdf-fork", name),
			DateCreated = created,
			DateModified = created,
			FileSize = size,
		};
		return entry;
	}

	static Settings GraySettings(float percent, double windowDays = 0) => new() {
		Percent = percent,
		TimeWindowDays = windowDays,
	};

	[Fact]
	public void BufferShrinksAsTheWindowGrows() {
		Assert.Equal(0, TimeWindow.BufferDays(0));
		double day = TimeWindow.BufferDays(1);
		double week = TimeWindow.BufferDays(7);
		double month = TimeWindow.BufferDays(30);
		double year = TimeWindow.BufferDays(365);
		Assert.InRange(day, 0.32, 0.34);
		Assert.InRange(week, 2.1, 2.3);
		Assert.InRange(month, 7.4, 7.6);
		Assert.InRange(year, 23.5, 24.5);
		Assert.True(year / 365 < month / 30);
	}

	[Fact]
	public void DatesShareAShortWindowOnlyWhenTheyAreClose() {
		DateTime start = TimeWindow.Epoch;
		Assert.True(TimeWindow.SharesWindow(start, start.AddDays(2), 7));
		Assert.False(TimeWindow.SharesWindow(start, start.AddDays(40), 7));
		Assert.True(TimeWindow.SharesWindow(start, start.AddDays(400), 0));
		Assert.True(TimeWindow.SharesWindow(start, start.AddDays(20), 30));
		Assert.False(TimeWindow.SharesWindow(start, start.AddDays(80), 30));
	}

	[Fact]
	public void SecondCompareDoesNotRequestGrayForOldPairs() {
		var store = new PairScoreStore();
		var settings = GraySettings(96);
		var older = Entry("a.jpg", TimeWindow.Epoch);
		var kept = Entry("b.jpg", TimeWindow.Epoch.AddDays(1));
		var added = Entry("c.jpg", TimeWindow.Epoch.AddDays(2));
		store.UpsertGray(older, kept, 92);
		store.MarkCovered(new[] { older, kept }, windowDays: 0, settings);

		PairCompareAction again = store.Decide(older, kept, settings);
		Assert.Equal(PairCompareAction.UseStored, again);
		Assert.False(PairCompareActions.RequestsGray(again));

		PairCompareAction fresh = store.Decide(older, added, settings);
		Assert.Equal(PairCompareAction.Compute, fresh);
		Assert.True(PairCompareActions.RequestsGray(fresh));
	}

	[Fact]
	public void PercentAboveTheFloorReusesAStoredScore() {
		var store = new PairScoreStore();
		var built = GraySettings(90);
		var a = Entry("a.jpg", TimeWindow.Epoch);
		var b = Entry("b.jpg", TimeWindow.Epoch);
		store.UpsertGray(a, b, 91);
		store.MarkCovered(new[] { a, b }, 0, built);

		Assert.Equal(PairCompareAction.UseStored, store.Decide(a, b, GraySettings(98)));
		Assert.Equal(PairCompareAction.Compute, store.Decide(a, b, GraySettings(80)));
	}

	[Fact]
	public void NarrowerWindowReusesSavedComparisons() {
		var store = new PairScoreStore();
		var wide = GraySettings(96, 30);
		var near = Entry("a.jpg", TimeWindow.Epoch);
		var alsoNear = Entry("b.jpg", TimeWindow.Epoch.AddDays(2));
		var mid = Entry("c.jpg", TimeWindow.Epoch.AddDays(20));
		var beside = Entry("d.jpg", TimeWindow.Epoch.AddDays(1));
		store.UpsertGray(near, alsoNear, 92);
		store.MarkCovered(new[] { near, alsoNear, beside, mid }, 30, wide);

		var narrow = GraySettings(96, 7);
		Assert.Equal(PairCompareAction.UseStored, store.Decide(near, alsoNear, narrow));
		Assert.Equal(PairCompareAction.Skip, store.Decide(near, beside, narrow));
		Assert.Equal(PairCompareAction.Skip, store.Decide(near, mid, narrow));

		store.MarkCovered(new[] { near, alsoNear, beside, mid }, 7, narrow);
		Assert.Equal(30, store.CoverageWindowDays);
		Assert.Equal(PairCompareAction.Skip, store.Decide(near, beside, GraySettings(96, 3)));
	}

	[Fact]
	public void WindowZeroComparesPairsOutsideTheSavedWindow() {
		var store = new PairScoreStore();
		var week = GraySettings(96, 7);
		var near = Entry("a.jpg", TimeWindow.Epoch);
		var alsoNear = Entry("b.jpg", TimeWindow.Epoch.AddDays(2));
		var far = Entry("c.jpg", TimeWindow.Epoch.AddDays(40));
		store.UpsertGray(near, alsoNear, 92);
		store.MarkCovered(new[] { near, alsoNear, far }, 7, week);

		var full = GraySettings(96, 0);
		Assert.Equal(PairCompareAction.UseStored, store.Decide(near, alsoNear, full));
		Assert.Equal(PairCompareAction.Compute, store.Decide(near, far, full));

		store.MarkCovered(new[] { near, alsoNear, far }, 0, full);
		Assert.Equal(0, store.CoverageWindowDays);
		Assert.Equal(PairCompareAction.Skip, store.Decide(near, far, full));
		Assert.Equal(PairCompareAction.UseStored, store.Decide(near, alsoNear, GraySettings(96, 7)));
	}
}
