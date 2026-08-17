using System.Text;

namespace DynastyTools.Csv;

/// <summary>
/// A small RFC 4180 CSV reader.
/// </summary>
/// <remarks>
/// Hand-rolled rather than taken from a package: the tool has no other
/// dependencies, and the format it needs to accept is exactly what a spreadsheet
/// exports — quoted fields, doubled quotes for a literal <c>"</c>, and newlines
/// inside quotes.
/// </remarks>
public static class CsvParser
{
    /// <summary>Splits CSV text into rows of raw fields.</summary>
    public static List<List<string>> ParseRows(string text)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;
        var fieldWasQuoted = false;
        var index = 0;

        // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
        // part of the first header name.
        if (text.Length > 0 && text[0] == '﻿')
        {
            index = 1;
        }

        void EndField()
        {
            row.Add(fieldWasQuoted ? field.ToString() : field.ToString().Trim());
            field.Clear();
            fieldWasQuoted = false;
        }

        void EndRow()
        {
            EndField();
            // Skip blank lines rather than emitting an empty record.
            if (row.Count > 1 || row[0].Length > 0)
            {
                rows.Add([.. row]);
            }
            row.Clear();
        }

        while (index < text.Length)
        {
            var character = text[index];

            if (inQuotes)
            {
                if (character == '"')
                {
                    if (index + 1 < text.Length && text[index + 1] == '"')
                    {
                        field.Append('"');
                        index += 2;
                        continue;
                    }
                    inQuotes = false;
                    index += 1;
                    continue;
                }

                field.Append(character);
                index += 1;
                continue;
            }

            switch (character)
            {
                case '"':
                    inQuotes = true;
                    fieldWasQuoted = true;
                    index += 1;
                    break;

                case ',':
                    EndField();
                    index += 1;
                    break;

                case '\r':
                    // Handle CRLF and a bare CR alike.
                    EndRow();
                    index += index + 1 < text.Length && text[index + 1] == '\n' ? 2 : 1;
                    break;

                case '\n':
                    EndRow();
                    index += 1;
                    break;

                default:
                    field.Append(character);
                    index += 1;
                    break;
            }
        }

        // Flush a trailing row that the file did not terminate with a newline.
        if (field.Length > 0 || row.Count > 0)
        {
            EndRow();
        }

        return rows;
    }

    /// <summary>
    /// Parses CSV with a header row into case-insensitive column lookups.
    /// </summary>
    public static List<Dictionary<string, string>> ParseRecords(string text)
    {
        var rows = ParseRows(text);
        if (rows.Count == 0)
        {
            return [];
        }

        var headers = rows[0].Select(header => header.Trim()).ToList();
        var records = new List<Dictionary<string, string>>();

        foreach (var row in rows.Skip(1))
        {
            var record = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (var column = 0; column < headers.Count; column += 1)
            {
                record[headers[column]] = column < row.Count ? row[column] : string.Empty;
            }
            records.Add(record);
        }

        return records;
    }
}
