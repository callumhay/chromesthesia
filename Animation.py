import numpy as np

def lerpstep(y0, y1, x):
  assert 0.0 <= x <= 1.0
  return y0 * (1.0 - x) + y1 * x

def smoothstep(y0, y1, x):
  assert 0.0 <= x <= 1.0
  if abs(y1-y0) < 1e-6:
    return y1
  v = max(0.0, min(1.0, ((x - y0) / (y1 - y0))))
  return v * v * (3.0 - 2.0 * v)

def sqrtstep(y0, y1, x):
  assert 0.0 <= x <= 1.0
  sqrt_x = np.sqrt(x)
  return lerpstep(y0, y1, sqrt_x)

class Animation(object):
  def __init__(self, init_value, final_value, duration_s, interpolation_fn):
    super(Animation, self).__init__()
    assert duration_s > 0.0
    self.reset(init_value, final_value, duration_s, interpolation_fn)

  def reset(self, init_value, final_value, duration_s=None, interpolation_fn=None):
    assert isinstance(init_value, (int, float)) and not isinstance(init_value, bool)
    assert type(init_value) == type(final_value)
    self.init_value = init_value
    self.final_value = final_value
    self._t = 0.0
    if (self.init_value - self.final_value) < 1e-6:
      self.init_value = self.final_value
      self.duration = 0.0
    elif duration_s is not None:
      self.duration = duration_s
    if interpolation_fn is not None:
      self.interpolation_fn = interpolation_fn
    self.curr_value = init_value

  def update(self, dt):
    assert dt >= 0.0
    self._t += dt
    p = 1.0
    if self.duration > 0:
      p = max(0.0, min(1.0, self._t / self.duration))
    self.curr_value = self.interpolation_fn(self.init_value, self.final_value, p)
    return self.curr_value

  def is_done(self):
    return self._t >= self.duration