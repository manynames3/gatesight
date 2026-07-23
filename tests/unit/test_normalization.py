from gatesight_domain.normalization import mask_plate, normalize_plate
from hypothesis import given
from hypothesis import strategies as st


@given(st.text())
def test_normalization_never_invents_characters(raw: str) -> None:
    normalized = normalize_plate(raw)
    if normalized is not None:
        expected = "".join(
            character for character in raw.upper() if character.isascii() and character.isalnum()
        )
        assert normalized == expected


def test_normalization_removes_separators_without_substitution() -> None:
    assert normalize_plate(" ab-c 123 ") == "ABC123"
    assert normalize_plate("") is None


def test_mask_plate_hides_internal_characters() -> None:
    assert mask_plate("ABC123") == "A••••3"
