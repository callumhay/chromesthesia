import numpy as np
from colormath.color_objects import sRGBColor, LCHuvColor
from colormath.color_conversions import convert_color

_GAMMA_LOOKUP = [
     0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
     0,   0,   0,   0,   0,   0,   0,   0,   0,   0,   1,   1,   1,   1,   1,   1,
     1,   1,   1,   1,   1,   1,   1,   2,   2,   2,   2,   2,   2,   2,   3,   3,
     3,   3,   3,   3,   3,   4,   4,   4,   4,   4,   5,   5,   5,   5,   6,   6,
     6,   6,   7,   7,   7,   7,   8,   8,   8,   9,   9,   9,  10,  10,  10,  11,
    11,  12,  12,  12,  13,  13,  14,  14,  14,  15,  15,  16,  16,  17,  17,  18,
    18,  19,  19,  20,  20,  21,  21,  22,  23,  23,  24,  24,  25,  26,  26,  27,
    28,  28,  29,  30,  30,  31,  32,  33,  33,  34,  35,  36,  36,  37,  38,  39,
    40,  41,  41,  42,  43,  44,  45,  46,  47,  48,  49,  50,  51,  51,  52,  53,
    55,  56,  57,  58,  59,  60,  61,  62,  63,  64,  65,  66,  68,  69,  70,  71,
    72,  74,  75,  76,  77,  79,  80,  81,  83,  84,  85,  87,  88,  89,  91,  92,
    94,  95,  97,  98, 100, 101, 103, 104, 106, 107, 109, 110, 112, 114, 115, 117,
   119, 120, 122, 124, 125, 127, 129, 131, 132, 134, 136, 138, 140, 141, 143, 145,
   147, 149, 151, 153, 155, 157, 159, 161, 163, 165, 167, 169, 171, 173, 175, 178,
   180, 182, 184, 186, 188, 191, 193, 195, 198, 200, 202, 205, 207, 209, 212, 214,
   216, 219, 221, 224, 226, 229, 231, 234, 237, 239, 242, 244, 247, 250, 252, 255,
]

def gamma(value: int):
  return _GAMMA_LOOKUP[value]

def rgb_to_lch(rgb):
  return np.array(convert_color(sRGBColor(*rgb), LCHuvColor).get_value_tuple(), dtype=np.float32)

def lch_to_rgb(lch):
  rgb = convert_color(LCHuvColor(*lch), sRGBColor)
  return np.array([
    rgb.clamped_rgb_r, rgb.clamped_rgb_g, rgb.clamped_rgb_b
  ], dtype=np.float32)
