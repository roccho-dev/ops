import unittest

from core import add, parse_pair


class CoreTest(unittest.TestCase):
    def test_golden(self):
        self.assertEqual(add(parse_pair({"left": 17, "right": 25})), 42)

    def test_negative(self):
        with self.assertRaises(ValueError):
            parse_pair({"left": "17", "right": 25})


if __name__ == "__main__":
    unittest.main()
