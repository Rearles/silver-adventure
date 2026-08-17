using DynastyTools.Editing;
using DynastyTools.Models;
using DynastyTools.Serialization;

namespace DynastyTools.Tests;

public class BulkEditorTests
{
    private static WorldPeopleFile World() => new()
    {
        People =
        [
            new Person { Id = "p1", Name = "Aldric", House = "Valcrest", Nation = "Astyria", Generation = 0 },
            new Person { Id = "p2", Name = "Seraphine", House = "Doryne", Nation = "Meruvia", Generation = 0 },
            new Person { Id = "p3", Name = "Rowan", House = "Valcrest", Nation = "Astyria", Generation = 1, Tags = ["monarch"] },
        ],
    };

    [Fact]
    public void AppliesASetToOnlyTheMatchingHouse()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(House: "Valcrest"),
            new Dictionary<string, string> { ["visibility"] = "hidden" });

        Assert.Equal(2, result.Matched);
        Assert.Equal("hidden", world.People.Single(p => p.Id == "p1").Visibility);
        Assert.Equal("hidden", world.People.Single(p => p.Id == "p3").Visibility);
        // The Doryne consort is untouched.
        Assert.Equal("known", world.People.Single(p => p.Id == "p2").Visibility);
    }

    [Fact]
    public void CombinesFiltersWithAnd()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(House: "Valcrest", Generation: 1),
            new Dictionary<string, string> { ["title"] = "King" });

        Assert.Equal(1, result.Matched);
        Assert.Equal("King", world.People.Single(p => p.Id == "p3").Title);
    }

    [Fact]
    public void FiltersByExplicitIds()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(Ids: ["p2"]),
            new Dictionary<string, string> { ["nation"] = "Astyria" });

        Assert.Equal(1, result.Matched);
        Assert.Equal("Astyria", world.People.Single(p => p.Id == "p2").Nation);
    }

    [Fact]
    public void FiltersByTag()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(Tag: "monarch"),
            new Dictionary<string, string> { ["addTag"] = "crowned" });

        Assert.Equal(1, result.Matched);
        Assert.Contains("crowned", world.People.Single(p => p.Id == "p3").Tags!);
    }

    [Fact]
    public void AddTagIsIdempotent()
    {
        var world = World();
        var assignments = new Dictionary<string, string> { ["addTag"] = "monarch" };

        BulkEditor.Apply(world, new BulkEditSelector(Ids: ["p3"]), assignments);
        var result = BulkEditor.Apply(world, new BulkEditSelector(Ids: ["p3"]), assignments);

        Assert.Single(world.People.Single(p => p.Id == "p3").Tags!);
        Assert.Empty(result.Changes);
    }

    [Fact]
    public void RemovingTheLastTagDropsTheListSoTheJsonOmitsIt()
    {
        var world = World();

        BulkEditor.Apply(
            world,
            new BulkEditSelector(Ids: ["p3"]),
            new Dictionary<string, string> { ["removeTag"] = "monarch" });

        Assert.Null(world.People.Single(p => p.Id == "p3").Tags);
    }

    [Fact]
    public void RejectsAnUnknownField()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(House: "Valcrest"),
            new Dictionary<string, string> { ["hairColour"] = "red" });

        Assert.NotEmpty(result.Problems);
        Assert.Equal(0, result.Matched);
    }

    [Fact]
    public void RejectsAnInvalidVisibilityValue()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(House: "Valcrest"),
            new Dictionary<string, string> { ["visibility"] = "maybe" });

        Assert.NotEmpty(result.Problems);
        Assert.Equal("known", world.People.Single(p => p.Id == "p1").Visibility);
    }

    [Fact]
    public void ReportsOnlyActualChanges()
    {
        var world = World();

        // p1 is already in Valcrest, so setting it again is not a change.
        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(Ids: ["p1"]),
            new Dictionary<string, string> { ["house"] = "Valcrest" });

        Assert.Equal(1, result.Matched);
        Assert.Empty(result.Changes);
    }

    [Fact]
    public void AnEmptySelectorMatchesEveryone()
    {
        var world = World();

        var result = BulkEditor.Apply(
            world,
            new BulkEditSelector(),
            new Dictionary<string, string> { ["nation"] = "Astyria" });

        Assert.Equal(3, result.Matched);
        // The CLI requires --all before it will pass an empty selector through.
        Assert.True(new BulkEditSelector().IsEmpty);
    }

    [Fact]
    public void SetsHideParentage()
    {
        var world = World();

        BulkEditor.Apply(
            world,
            new BulkEditSelector(Ids: ["p3"]),
            new Dictionary<string, string> { ["hideParentage"] = "yes" });

        Assert.True(world.People.Single(p => p.Id == "p3").HideParentage);
    }
}

public class WorldJsonTests
{
    [Fact]
    public void RoundTripsCamelCaseAndOmitsAbsentOptionalFields()
    {
        var file = new WorldPeopleFile
        {
            People =
            [
                new Person
                {
                    Id = "p1",
                    Name = "Rowan",
                    House = "Valcrest",
                    Nation = "Astyria",
                    Generation = 1,
                    IsAlive = true,
                    Visibility = "known",
                },
            ],
        };

        var json = WorldJson.SerializePeople(file);

        Assert.Contains("\"hideParentage\": false", json);
        Assert.Contains("\"parentIds\": []", json);
        // Optional fields that were never set must not appear as nulls.
        Assert.DoesNotContain("\"title\"", json);
        Assert.DoesNotContain("\"gmNotes\"", json);
        Assert.DoesNotContain("null", json);
        Assert.EndsWith(Environment.NewLine, json);
    }

    [Fact]
    public void ReadsCamelCaseBackIntoTheModel()
    {
        const string json = """
            {
              "people": [
                {
                  "id": "p1",
                  "name": "Rowan",
                  "house": "Valcrest",
                  "nation": "Astyria",
                  "isAlive": false,
                  "parentIds": ["a", "b"],
                  "spouseIds": [],
                  "generation": 1,
                  "visibility": "hidden",
                  "hideParentage": true,
                  "gmNotes": { "secrets": "known only to the GM" }
                }
              ]
            }
            """;

        var file = System.Text.Json.JsonSerializer.Deserialize<WorldPeopleFile>(json, WorldJson.Options);

        var person = Assert.Single(file!.People);
        Assert.Equal("Rowan", person.Name);
        Assert.Equal(["a", "b"], person.ParentIds);
        Assert.Equal("hidden", person.Visibility);
        Assert.True(person.HideParentage);
        Assert.Equal("known only to the GM", person.GmNotes!.Secrets);
    }

    [Fact]
    public void SerializationIsStableAcrossARoundTrip()
    {
        const string json = """
            {
              "people": [
                {
                  "id": "p1",
                  "name": "Rowan",
                  "house": "Valcrest",
                  "nation": "Astyria",
                  "isAlive": false,
                  "parentIds": [],
                  "spouseIds": [],
                  "generation": 1,
                  "visibility": "known",
                  "hideParentage": false
                }
              ]
            }

            """;

        var once = WorldJson.SerializePeople(
            System.Text.Json.JsonSerializer.Deserialize<WorldPeopleFile>(json, WorldJson.Options)!);
        var twice = WorldJson.SerializePeople(
            System.Text.Json.JsonSerializer.Deserialize<WorldPeopleFile>(once, WorldJson.Options)!);

        Assert.Equal(once, twice);
    }

    [Fact]
    public void PreservesNonAsciiCharactersUnescaped()
    {
        var file = new WorldPeopleFile
        {
            People = [new Person { Id = "p1", Name = "Étienne d'Or", House = "Valcrest", Nation = "Astyria" }],
        };

        var json = WorldJson.SerializePeople(file);

        Assert.Contains("Étienne d'Or", json);
    }

    [Fact]
    public void DerivesThePairedEventsPath()
    {
        Assert.Equal(
            Path.Combine("data", "astyria-events.json"),
            WorldJson.EventsPathFor(Path.Combine("data", "astyria.json")));
    }
}
