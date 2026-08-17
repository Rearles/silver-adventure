using DynastyTools.Models;
using DynastyTools.Validation;

namespace DynastyTools.Tests;

public class WorldValidatorTests
{
    private static Person Person(
        string id,
        string? name = null,
        string house = "Valcrest",
        string nation = "Astyria",
        int generation = 0,
        string visibility = "known",
        bool isAlive = true,
        int? birthYear = null,
        int? deathYear = null,
        List<string>? parentIds = null,
        List<string>? spouseIds = null,
        bool hideParentage = false) => new()
        {
            Id = id,
            Name = name ?? id,
            House = house,
            Nation = nation,
            Generation = generation,
            Visibility = visibility,
            IsAlive = isAlive,
            BirthYear = birthYear,
            DeathYear = deathYear,
            ParentIds = parentIds ?? [],
            SpouseIds = spouseIds ?? [],
            HideParentage = hideParentage,
        };

    private static WorldPeopleFile World(params Person[] people) => new() { People = [.. people] };

    private static bool Has(List<Finding> findings, string code) =>
        findings.Any(finding => finding.Code == code);

    [Fact]
    public void CleanWorldProducesNoFindings()
    {
        var world = World(
            Person("p1", generation: 0, isAlive: false, birthYear: 1400, deathYear: 1460, spouseIds: ["p2"]),
            Person("p2", generation: 0, isAlive: false, birthYear: 1405, deathYear: 1465, spouseIds: ["p1"]),
            Person("p3", generation: 1, birthYear: 1430, parentIds: ["p1", "p2"]));

        var findings = WorldValidator.Validate(world);

        Assert.Empty(findings);
    }

    [Fact]
    public void DetectsDuplicateIds()
    {
        var world = World(Person("p1"), Person("p1", name: "Impostor"));

        Assert.True(Has(WorldValidator.Validate(world), "duplicate-id"));
    }

    [Fact]
    public void DetectsDanglingParentReference()
    {
        var world = World(Person("p1", generation: 1, parentIds: ["ghost"]));

        var findings = WorldValidator.Validate(world);

        Assert.True(Has(findings, "dangling-parent"));
        Assert.Contains(findings, finding => finding.Severity == Severity.Error);
    }

    [Fact]
    public void DetectsDanglingSpouseReference()
    {
        var world = World(Person("p1", spouseIds: ["ghost"]));

        Assert.True(Has(WorldValidator.Validate(world), "dangling-spouse"));
    }

    [Fact]
    public void DetectsOneSidedMarriage()
    {
        var world = World(
            Person("p1", spouseIds: ["p2"]),
            Person("p2"));

        Assert.True(Has(WorldValidator.Validate(world), "asymmetric-marriage"));
    }

    [Fact]
    public void AcceptsMultipleMarriagesWhenSymmetric()
    {
        var world = World(
            Person("king", spouseIds: ["wife1", "wife2"]),
            Person("wife1", spouseIds: ["king"]),
            Person("wife2", spouseIds: ["king"]));

        var findings = WorldValidator.Validate(world);

        Assert.False(Has(findings, "asymmetric-marriage"));
    }

    [Fact]
    public void DetectsSelfParentAndSelfSpouse()
    {
        var world = World(Person("p1", parentIds: ["p1"], spouseIds: ["p1"]));

        var findings = WorldValidator.Validate(world);

        Assert.True(Has(findings, "self-parent"));
        Assert.True(Has(findings, "self-spouse"));
    }

    [Fact]
    public void DetectsMoreThanTwoParents()
    {
        var world = World(
            Person("a"), Person("b"), Person("c"),
            Person("child", generation: 1, parentIds: ["a", "b", "c"]));

        Assert.True(Has(WorldValidator.Validate(world), "too-many-parents"));
    }

    [Fact]
    public void DetectsInvalidVisibility()
    {
        var world = World(Person("p1", visibility: "secretish"));

        Assert.True(Has(WorldValidator.Validate(world), "bad-visibility"));
    }

    [Fact]
    public void DetectsDeathBeforeBirth()
    {
        var world = World(Person("p1", isAlive: false, birthYear: 1460, deathYear: 1400));

        Assert.True(Has(WorldValidator.Validate(world), "death-before-birth"));
    }

    [Fact]
    public void DetectsChildBornBeforeParent()
    {
        var world = World(
            Person("parent", generation: 0, birthYear: 1450),
            Person("child", generation: 1, birthYear: 1440, parentIds: ["parent"]));

        var findings = WorldValidator.Validate(world);

        Assert.True(Has(findings, "child-before-parent"));
        // A fictional setting may have reasons; this must not block the file.
        Assert.All(
            findings.Where(finding => finding.Code == "child-before-parent"),
            finding => Assert.Equal(Severity.Warning, finding.Severity));
    }

    [Fact]
    public void DetectsChildBornLongAfterParentDeath()
    {
        var world = World(
            Person("parent", generation: 0, isAlive: false, birthYear: 1400, deathYear: 1450),
            Person("child", generation: 1, birthYear: 1460, parentIds: ["parent"]));

        Assert.True(Has(WorldValidator.Validate(world), "child-after-parent-death"));
    }

    [Fact]
    public void AllowsPosthumousBirthWithinOneYear()
    {
        var world = World(
            Person("parent", generation: 0, isAlive: false, birthYear: 1400, deathYear: 1450),
            Person("child", generation: 1, birthYear: 1451, parentIds: ["parent"]));

        Assert.False(Has(WorldValidator.Validate(world), "child-after-parent-death"));
    }

    [Fact]
    public void DetectsGenerationGap()
    {
        var world = World(
            Person("parent", generation: 0),
            Person("child", generation: 3, parentIds: ["parent"]));

        Assert.True(Has(WorldValidator.Validate(world), "generation-gap"));
    }

    [Fact]
    public void DetectsDirectParentageCycle()
    {
        var world = World(
            Person("a", parentIds: ["b"]),
            Person("b", parentIds: ["a"]));

        var findings = WorldValidator.Validate(world);

        Assert.True(Has(findings, "parentage-cycle"));
    }

    [Fact]
    public void DetectsLongerParentageCycle()
    {
        var world = World(
            Person("a", parentIds: ["c"]),
            Person("b", parentIds: ["a"]),
            Person("c", parentIds: ["b"]));

        Assert.True(Has(WorldValidator.Validate(world), "parentage-cycle"));
    }

    [Fact]
    public void DeepAcyclicTreeIsNotReportedAsCycle()
    {
        // A diamond: both parents share a grandparent. Legal, and common in dynasties.
        var world = World(
            Person("gp", generation: 0),
            Person("m", generation: 1, parentIds: ["gp"]),
            Person("f", generation: 1, parentIds: ["gp"]),
            Person("child", generation: 2, parentIds: ["m", "f"]));

        Assert.False(Has(WorldValidator.Validate(world), "parentage-cycle"));
    }

    [Fact]
    public void FlagsPointlessHideParentage()
    {
        var world = World(Person("p1", hideParentage: true));

        Assert.True(Has(WorldValidator.Validate(world), "pointless-hideparentage"));
    }

    // ── Events ───────────────────────────────────────────────────────────────

    [Fact]
    public void DetectsDanglingEventPerson()
    {
        var world = World(Person("p1"));
        var events = new WorldEventsFile
        {
            Events =
            [
                new DynastyEvent
                {
                    Id = "e1",
                    Title = "A wedding",
                    Type = "wedding",
                    Year = 1450,
                    RelatedPersonIds = ["p1", "ghost"],
                },
            ],
        };

        Assert.True(Has(WorldValidator.Validate(world, events), "dangling-event-person"));
    }

    [Fact]
    public void DetectsInvalidEventType()
    {
        var world = World(Person("p1"));
        var events = new WorldEventsFile
        {
            Events = [new DynastyEvent { Id = "e1", Title = "Feast", Type = "banquet", Year = 1450 }],
        };

        Assert.True(Has(WorldValidator.Validate(world, events), "bad-event-type"));
    }

    [Fact]
    public void WarnsWhenAPlayerVisibleEventInvolvesAHiddenPerson()
    {
        // The projection scrubs the id, but the title may still name them.
        var world = World(
            Person("p1"),
            Person("secret", name: "Nyx", visibility: "hidden"));
        var events = new WorldEventsFile
        {
            Events =
            [
                new DynastyEvent
                {
                    Id = "e1",
                    Title = "The birth of Nyx",
                    Type = "birth",
                    Year = 1465,
                    RelatedPersonIds = ["p1", "secret"],
                    Visibility = "known",
                },
            ],
        };

        var findings = WorldValidator.Validate(world, events);

        Assert.True(Has(findings, "known-event-hidden-person"));
    }

    [Fact]
    public void DoesNotWarnWhenTheEventItselfIsHidden()
    {
        var world = World(
            Person("p1"),
            Person("secret", name: "Nyx", visibility: "hidden"));
        var events = new WorldEventsFile
        {
            Events =
            [
                new DynastyEvent
                {
                    Id = "e1",
                    Title = "The birth of Nyx",
                    Type = "birth",
                    Year = 1465,
                    RelatedPersonIds = ["secret"],
                    Visibility = "hidden",
                },
            ],
        };

        Assert.False(Has(WorldValidator.Validate(world, events), "known-event-hidden-person"));
    }
}
