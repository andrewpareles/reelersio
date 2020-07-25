// add any number of vectors
const add = (...vecs) => {
  let x = 0, y = 0;
  for (let v of vecs) {
    x += v.x;
    y += v.y;
  }
  return { x: x, y: y };
};

const weightedSum = (weights, ...vecs) => {
  if (weights.length !== vecs.length) throw 'weightedAverage expected weights and vecs to be same length';
  let x = 0, y = 0;
  for (let [i, v] of vecs.entries()) {
    x += v.x * weights[i];
    y += v.y * weights[i];
  }
  return { x: x, y: y };
}

const negative = (a) => {
  return scalar(a, -1);
};

// a - b. a = to, b = from
const sub = (a, b) => {
  return add(a, negative(b));
}

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

const dot = (a, b) => {
  return a.x * b.x + a.y * b.y;
}

// a = location of a, b = loc of b, r_a = radius of a, r_b = radius of b
const isCollided = (a, b, r_a, r_b) => {
  return magnitude(sub(a, b)) <= r_a + r_b;
}

// outside = location of outside object, r_out = radius of it
// requires r_out > r_in
const isContaining = (outside, inside, r_out, r_in) => {
  return magnitude(sub(outside, inside)) <= r_out - r_in;
}

const average = (...vecs) => {
  return scalar(add(...vecs), 1 / vecs.length);
}

const apply = (vec, fn, ...args) => {
  return { x: fn(vec.x, ...args), y: fn(vec.y, ...args) };
}

const crossMagnitude = (a, b) => {
  return a.x * b.y - a.y * b.x;
}

const zero = { x: 0, y: 0 };

//returns component of `a` projected onto normalized direction of b
const parallelComponentMagnitude = (a, b) => {
  return dot(a, normalized(b));
}

//returns a projected on b
const parallelComponent = (a, b) => {
  return normalized(b, parallelComponentMagnitude(a, b));
}

//returns `a` projected on orthogonal of normalized(b), ie complement component to the parallel component 
const orthogonalComponent = (a, b) => {
  return sub(a, parallelComponent(a, b));
}

const rotatedByTheta = (a, theta) => {
  let cos = Math.cos(theta);
  let sin = Math.sin(theta);
  return { x: a.x * cos + a.y * -sin, y: a.x * sin + a.y * cos };
}

exports.vec = {
  add,
  weightedSum,
  negative,
  sub,
  scalar,
  magnitude,
  equals,
  nonzero,
  normalized,
  dot,
  isCollided,
  isContaining,
  average,
  apply,
  crossMagnitude,
  parallelComponent,
  parallelComponentMagnitude,
  orthogonalComponent,
  rotatedByTheta,
  zero,

}
