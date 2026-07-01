"""Parity tests guarding the note-colour refactor.

NoteUtils used to hardcode CIRCLE_OF_FIFTHS_NOTE_NAMES and NOTE_COLOURS. Those
values now live in note_colours.json (shared with the web view). These tests
pin the exact pre-refactor values so the LED output can never silently change
when the JSON is edited by mistake.

Run: python3 -m unittest test_note_utils
"""
import unittest

import numpy as np

import NoteUtils


# The exact hardcoded values that shipped before the JSON refactor. LEDs
# depend on these; do not change without intending to change the lights.
GOLDEN_CIRCLE_OF_FIFTHS = ['A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
GOLDEN_NOTE_COLOURS = [
    [1., 0., 0.],    # A
    [1., .35, 0.],   # E
    [1., .55, 0.],   # B
    [1., 1., 0.],    # Gb
    [.5, .65, 0.],   # Db
    [0., 1., .5],    # Ab
    [0., 1., 1.],    # Eb
    [0., .5, 1.],    # Bb
    [0., 0., 1.],    # F
    [.6, 0., .9],    # C
    [1., 0., 1.],    # G
    [1., 0., .5],    # D
]


class NoteColourParityTest(unittest.TestCase):
    def test_circle_of_fifths_order_unchanged(self):
        self.assertEqual(NoteUtils.CIRCLE_OF_FIFTHS_NOTE_NAMES, GOLDEN_CIRCLE_OF_FIFTHS)

    def test_note_colours_unchanged(self):
        self.assertEqual(len(NoteUtils.NOTE_COLOURS), len(GOLDEN_NOTE_COLOURS))
        for name, actual, expected in zip(
            GOLDEN_CIRCLE_OF_FIFTHS, NoteUtils.NOTE_COLOURS, GOLDEN_NOTE_COLOURS
        ):
            self.assertEqual(list(actual), expected, f"colour changed for {name}")

    def test_note_to_rgb_matches_golden(self):
        for name, expected in zip(GOLDEN_CIRCLE_OF_FIFTHS, GOLDEN_NOTE_COLOURS):
            rgb = NoteUtils.note_to_rgb(name, 1.0)
            self.assertTrue(
                np.allclose(rgb, np.array(expected, dtype=np.float32)),
                f"note_to_rgb('{name}') = {rgb}, expected {expected}",
            )

    def test_every_fifths_name_has_a_colour(self):
        self.assertEqual(
            len(NoteUtils.CIRCLE_OF_FIFTHS_NOTE_NAMES), len(NoteUtils.NOTE_COLOURS)
        )


if __name__ == '__main__':
    unittest.main()
