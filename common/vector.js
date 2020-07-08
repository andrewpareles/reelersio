// add any number of vectors
const add = (...vecs) => {
  let x = 0, y = 0;
  for (let v of vecs) {
    x += v.x;
    y += v.y;
  }
  return { x: x, y: y };
};

// s*v, a is scalar, v is vector
const scalar = (v, s) => {
  return { x: s * v.x, y: s * v.y };
};

// the magnitude of the vector
const magnitude = (a) => {
  return Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
};

// neither vector is null, and they have same values
const equals = (a, b) => {
  return !!a && !!b && a.x == b.x && a.y == b.y;
};

// vector is not null, and doesnt contain all falsy values (including 0)
const nonzero = (a) => {
  return !!a && (!!a.x || !!a.y);
};

// if unnormalizable, return the 0 vector. 
// Normalizes to a vector of size mag, or 1 if undefined
const normalized = (a, mag) => {
  if (!mag) {
    if (mag !== 0) mag = 1;
    else return { x: 0, y: 0 };
  }
  let norm = magnitude(a);
  return norm == 0 ? { x: 0, y: 0 } : scalar(a, mag / norm);
};

const negative = (a) => {
  return scalar(a, -1);
};

const dot = (a, b) => {
  return a.x * b.x + a.y * b.y;
}

const isCollided = (a, b, r_a, r_b) => {
  return magnitude(add(a, negative(b))) < r_a + r_b
}

// a - b. a = to, b = from
const sub = (a, b) => {
  return add(a, negative(b));
}

const average = (vecs) => {
  return scalar(add(...vecs), 1 / vecs.length);
}

exports.vec = {
  add: add,
  scalar: scalar,
  magnitude: magnitude,
  equals: equals,
  nonzero: nonzero,
  normalized: normalized,
  negative: negative,
  dot: dot,
  isCollided: isCollided,
  sub: sub,
  average: average,

}
