using System.Text.Json;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Documents;
using Tamma.Core.Documents.Types;

namespace Tamma.Core.Tests.Documents.Types;

/// <summary>
/// Story 39-3 AC5 — two-phase rules for <see cref="ClarificationDocumentType"/>:
/// open-ended questions (D4) and resolution references.
/// </summary>
[TestFixture]
public class ClarificationDocumentTypeTests
{
    private static readonly ClarificationDocumentType Type = new();

    private static DocumentValidationResult Validate(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return Type.Validate(doc.RootElement);
    }

    private static IEnumerable<string> Codes(DocumentValidationResult r) => r.Violations.Select(v => v.Code);

    [Test]
    public void The_resolution_shape_the_contract_prescribes_is_valid()
    {
        // RenderContract() is what the repair ring shows the model. A model that copies
        // its RESOLUTION shape exactly must pass Validate — otherwise every repair of a
        // resolution fails again and the run ends validation-exhausted. The validator
        // resolves each questionId against THIS document's questions, so the shape has
        // to carry them.
        var contract = Type.RenderContract();
        var start = contract.IndexOf("\"phase\": \"resolution\"", StringComparison.Ordinal);
        start.Should().BeGreaterThan(0, "the contract describes the resolution phase");
        var open = contract.LastIndexOf('{', start);
        var close = open;
        for (var depth = 0; close < contract.Length; close++)
        {
            if (contract[close] == '{') depth++;
            else if (contract[close] == '}' && --depth == 0) break;
        }
        var shape = contract[open..(close + 1)];

        var r = Validate(shape);

        r.IsValid.Should().BeTrue($"violations: {string.Join(", ", Codes(r))}; shape: {shape}");
    }

    [Test]
    public void Questions_phase_with_one_open_question_is_valid()
    {
        var r = Validate("""{ "phase": "questions", "questions": ["What is the target platform?"] }""");
        r.IsValid.Should().BeTrue(string.Join(", ", Codes(r)));
    }

    [Test]
    public void Zero_questions_is_no_open_question()
    {
        var r = Validate("""{ "phase": "questions", "questions": [] }""");
        Codes(r).Should().Contain(ClarificationDocumentType.NoOpenQuestion);
    }

    [Test]
    public void All_closed_form_questions_is_no_open_question()
    {
        var r = Validate("""{ "phase": "questions", "questions": ["Is it fast?", "Should we ship?"] }""");
        Codes(r).Should().Contain(ClarificationDocumentType.NoOpenQuestion);
    }

    [Test]
    public void Mixed_set_with_one_open_question_is_valid()
    {
        // "Is it fast?" is closed-form; "What should we build?" is open — the
        // conservative D4 rule fires only when ALL are closed.
        var r = Validate(
            """{ "phase": "questions", "questions": ["Is it fast?", "What should we build?"] }""");

        Codes(r).Should().NotContain(ClarificationDocumentType.NoOpenQuestion);
        r.IsValid.Should().BeTrue(string.Join(", ", Codes(r)));
    }

    [Test]
    public void Closed_form_with_or_alternative_is_open()
    {
        // An "or"-alternative is not a simple yes/no — not closed-form.
        var r = Validate(
            """{ "phase": "questions", "questions": ["Should we use Redis or Postgres?"] }""");

        Codes(r).Should().NotContain(ClarificationDocumentType.NoOpenQuestion);
    }

    [Test]
    public void Empty_question_entry_is_reported()
    {
        var r = Validate(
            """{ "phase": "questions", "questions": ["What is expected?", "  "] }""");

        Codes(r).Should().Contain(ClarificationDocumentType.EmptyQuestion);
    }

    [Test]
    public void Resolution_phase_without_clarified_requirement_is_reported()
    {
        var r = Validate(
            """{ "phase": "resolution", "questions": ["What?"], "resolutions": [ { "questionId": "Q-1", "requirement": "web" } ] }""");

        Codes(r).Should().Contain(ClarificationDocumentType.MissingClarifiedRequirement);
    }

    [Test]
    public void Resolution_with_empty_requirement_is_reported()
    {
        var r = Validate(
            """
            { "phase": "resolution", "clarifiedRequirement": "the requirement", "questions": ["What?"],
              "resolutions": [ { "questionId": "Q-1", "requirement": "" } ] }
            """);

        Codes(r).Should().Contain(ClarificationDocumentType.EmptyResolution);
    }

    [Test]
    public void Resolution_referencing_unknown_question_is_reported()
    {
        var r = Validate(
            """
            { "phase": "resolution", "clarifiedRequirement": "the requirement",
              "questions": ["Q1?", "Q2?", "Q3?"],
              "resolutions": [ { "questionId": "Q-9", "requirement": "web" } ] }
            """);

        Codes(r).Should().Contain(ClarificationDocumentType.UnknownQuestionRef);
    }

    [Test]
    public void Valid_resolution_phase_passes()
    {
        var r = Validate(
            """
            { "phase": "resolution", "clarifiedRequirement": "the full disambiguated requirement",
              "questions": ["What is the target platform?"],
              "resolutions": [ { "questionId": "Q-1", "requirement": "web only" } ],
              "remainingAmbiguities": [], "resolved": true }
            """);

        r.IsValid.Should().BeTrue(string.Join(", ", Codes(r)));
    }

    [Test]
    public void Bad_phase_is_unknown_phase()
    {
        var r = Validate("""{ "phase": "answers", "questions": ["What?"] }""");

        r.IsValid.Should().BeFalse();
        Codes(r).Should().Equal(new[] { ClarificationDocumentType.UnknownPhase });
    }
}
