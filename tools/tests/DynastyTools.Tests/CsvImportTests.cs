using DynastyTools.Csv;
using DynastyTools.Editing;
using DynastyTools.Models;

namespace DynastyTools.Tests;

public class CsvParserTests
{
    [Fact]
    public void ParsesASimpleTable()
    {
        var rows = CsvParser.ParseRows("a,b,c\n1,2,3\n");

        Assert.Equal(2, rows.Count);
        Assert.Equal(["a", "b", "c"], rows[0]);
        Assert.Equal(["1", "2", "3"], rows[1]);
    }

    [Fact]
    public void HandlesQuotedFieldsContainingCommas()
    {
        var rows = CsvParser.ParseRows("name,notes\nRowan,\"Twice married, twice crowned\"\n");

        Assert.Equal("Twice married, twice crowned", rows[1][1]);
    }

    [Fact]
    public void HandlesDoubledQuotesAsALiteralQuote()
    {
        var rows = CsvParser.ParseRows("name\n\"The \"\"Kingmaker\"\"\"\n");

        Assert.Equal("The \"Kingmaker\"", rows[1][0]);
    }

    [Fact]
    public void HandlesNewlinesInsideQuotedFields()
    {
        var rows = CsvParser.ParseRows("name,notes\nRowan,\"line one\nline two\"\n");

        Assert.Equal(2, rows.Count);
        Assert.Equal("line one\nline two", rows[1][1]);
    }

    [Fact]
    public void HandlesCrlfLineEndings()
    {
        var rows = CsvParser.ParseRows("a,b\r\n1,2\r\n");

        Assert.Equal(2, rows.Count);
        Assert.Equal(["1", "2"], rows[1]);
    }

    [Fact]
    public void HandlesAFinalRowWithoutATrailingNewline()
    {
        var rows = CsvParser.ParseRows("a,b\n1,2");

        Assert.Equal(2, rows.Count);
        Assert.Equal(["1", "2"], rows[1]);
    }

    [Fact]
    public void SkipsBlankLines()
    {
        var rows = CsvParser.ParseRows("a\n1\n\n2\n");

        Assert.Equal(3, rows.Count);
    }

    [Fact]
    public void StripsAUtf8ByteOrderMarkFromTheFirstHeader()
    {
        var rows = CsvParser.ParseRows("﻿name,house\nRowan,Valcrest\n");

        Assert.Equal("name", rows[0][0]);
    }

    [Fact]
    public void ParseRecordsKeysColumnsCaseInsensitively()
    {
        var records = CsvParser.ParseRecords("Name,House\nRowan,Valcrest\n");

        Assert.Single(records);
        Assert.Equal("Rowan", records[0]["name"]);
        Assert.Equal("Valcrest", records[0]["HOUSE"]);
    }
}

public class PersonCsvMapperTests
{
    private static List<Person> Map(string csv) =>
        PersonCsvMapper.Map(CsvParser.ParseRecords(csv)).People;

    [Fact]
    public void MapsCoreFields()
    {
        var people = Map(
            "id,name,house,nation,title,birthYear,deathYear,generation,visibility\n"
            + "p1,Rowan Valcrest,Valcrest,Astyria,King Rowan II,1430,1495,1,known\n");

        var person = Assert.Single(people);
        Assert.Equal("p1", person.Id);
        Assert.Equal("Rowan Valcrest", person.Name);
        Assert.Equal("King Rowan II", person.Title);
        Assert.Equal(1430, person.BirthYear);
        Assert.Equal(1495, person.DeathYear);
        Assert.Equal(1, person.Generation);
        Assert.Equal("known", person.Visibility);
    }

    [Fact]
    public void SplitsListColumnsOnSemicolons()
    {
        var people = Map(
            "id,name,parentIds,spouseIds,tags\n"
            + "p3,Heir,p1;p2,p4;p5,heir;monarch\n");

        var person = Assert.Single(people);
        Assert.Equal(["p1", "p2"], person.ParentIds);
        Assert.Equal(["p4", "p5"], person.SpouseIds);
        Assert.Equal(["heir", "monarch"], person.Tags);
    }

    [Fact]
    public void LeavesTagsNullWhenTheColumnIsBlankSoTheJsonOmitsIt()
    {
        var people = Map("id,name,tags\np1,Rowan,\n");

        Assert.Null(Assert.Single(people).Tags);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("yes", true)]
    [InlineData("y", true)]
    [InlineData("1", true)]
    [InlineData("false", false)]
    [InlineData("no", false)]
    [InlineData("0", false)]
    public void AcceptsCommonSpreadsheetBooleans(string raw, bool expected)
    {
        var people = Map($"id,name,isAlive\np1,Rowan,{raw}\n");

        Assert.Equal(expected, Assert.Single(people).IsAlive);
    }

    [Fact]
    public void InfersIsAliveFromAbsenceOfADeathYearWhenTheColumnIsMissing()
    {
        var living = Map("id,name\np1,Elara\n");
        Assert.True(Assert.Single(living).IsAlive);

        var deceased = Map("id,name,deathYear\np1,Aldric,1468\n");
        Assert.False(Assert.Single(deceased).IsAlive);
    }

    [Fact]
    public void GeneratesIdsForRowsWithoutOneWithoutCollidingWithSuppliedIds()
    {
        var people = Map("id,name\np1,Given\n,Blank one\n,Blank two\n");

        Assert.Equal(3, people.Count);
        Assert.All(people, person => Assert.False(string.IsNullOrWhiteSpace(person.Id)));
        Assert.Equal(3, people.Select(person => person.Id).Distinct().Count());
        Assert.DoesNotContain("p1", people.Skip(1).Select(person => person.Id));
    }

    [Fact]
    public void ReportsAndSkipsRowsWithoutAName()
    {
        var result = PersonCsvMapper.Map(CsvParser.ParseRecords("id,name\np1,\np2,Real\n"));

        Assert.Single(result.People);
        Assert.Contains(result.Problems, problem => problem.Contains("no name"));
    }

    [Fact]
    public void ReportsUnparseableNumbersRatherThanThrowing()
    {
        var result = PersonCsvMapper.Map(CsvParser.ParseRecords("id,name,birthYear\np1,Rowan,circa 1430\n"));

        Assert.Null(Assert.Single(result.People).BirthYear);
        Assert.Contains(result.Problems, problem => problem.Contains("birthYear"));
    }

    [Fact]
    public void DefaultsAnUnrecognisedVisibilityToKnownAndReportsIt()
    {
        var result = PersonCsvMapper.Map(CsvParser.ParseRecords("id,name,visibility\np1,Rowan,maybe\n"));

        Assert.Equal("known", Assert.Single(result.People).Visibility);
        Assert.Contains(result.Problems, problem => problem.Contains("visibility"));
    }
}

public class WorldMergerTests
{
    private static WorldPeopleFile ExistingWorld() => new()
    {
        People =
        [
            new Person
            {
                Id = "p1",
                Name = "Rowan Valcrest",
                House = "Valcrest",
                Nation = "Astyria",
                Generation = 1,
                IsAlive = false,
                GmNotes = new GmNotes { Secrets = "Fathered Corin." },
            },
        ],
    };

    [Fact]
    public void PreservesAnExistingPersonsGmNotesOnUpdate()
    {
        var world = ExistingWorld();
        var incoming = new List<Person>
        {
            new() { Id = "p1", Name = "Rowan Valcrest II", House = "Valcrest", Nation = "Astyria" },
        };

        var result = WorldMerger.Merge(world, incoming);

        var person = Assert.Single(world.People);
        Assert.Equal("Rowan Valcrest II", person.Name);
        // The dossier is the least replaceable data in the file.
        Assert.NotNull(person.GmNotes);
        Assert.Equal("Fathered Corin.", person.GmNotes!.Secrets);
        Assert.Equal(1, result.Updated);
        Assert.Equal(0, result.Added);
    }

    [Fact]
    public void AppendsPeopleWithUnseenIds()
    {
        var world = ExistingWorld();
        var incoming = new List<Person>
        {
            new() { Id = "p99", Name = "New Person", House = "Ashfell", Nation = "Astyria" },
        };

        var result = WorldMerger.Merge(world, incoming);

        Assert.Equal(2, world.People.Count);
        Assert.Equal(1, result.Added);
    }

    [Fact]
    public void MakesSpouseLinksSymmetricAfterMerge()
    {
        var world = new WorldPeopleFile();
        var incoming = new List<Person>
        {
            new() { Id = "a", Name = "A", SpouseIds = ["b"] },
            new() { Id = "b", Name = "B" },
        };

        WorldMerger.Merge(world, incoming);

        Assert.Equal(["a"], world.People.Single(person => person.Id == "b").SpouseIds);
    }

    [Fact]
    public void DropsSpouseAndParentIdsThatPointAtNobody()
    {
        var world = new WorldPeopleFile();
        var incoming = new List<Person>
        {
            new() { Id = "a", Name = "A", SpouseIds = ["ghost"], ParentIds = ["phantom"] },
        };

        WorldMerger.Merge(world, incoming);

        var person = Assert.Single(world.People);
        Assert.Empty(person.SpouseIds);
        Assert.Empty(person.ParentIds);
    }

    [Fact]
    public void CapsParentsAtTwo()
    {
        var world = new WorldPeopleFile();
        var incoming = new List<Person>
        {
            new() { Id = "a", Name = "A" },
            new() { Id = "b", Name = "B" },
            new() { Id = "c", Name = "C" },
            new() { Id = "child", Name = "Child", ParentIds = ["a", "b", "c"] },
        };

        WorldMerger.Merge(world, incoming);

        Assert.Equal(2, world.People.Single(person => person.Id == "child").ParentIds.Count);
    }
}
