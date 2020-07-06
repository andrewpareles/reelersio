exports.vec = {
  // add vector a and b
  add: (...vecs) => {
    let x = 0, y = 0;
    for (let v of vecs) {
      x += v.x;
      y += v.y;
    }
    return { x: x, y: y };
  },

  // s*v, a is scalar, v is vector
  scalar: (v, s) => {
    return { x: s * v.x, y: s * v.y };
  },

  // the magnitude of the vector
  mag: (a) => {
    return Math.sqrt(Math.pow(a.x, 2) + Math.pow(a.y, 2));
  },

  // neither vector is null, and they have same values
  equals: (a, b) => {
    return !!a && !!b && a.x == b.x && a.y == b.y;
  },

  // vector is not null, and doesnt contain all falsy values (including 0)
  nonzero: (a) => {
    return !!a && (!!a.x || !!a.y);
  },

  // if unnormalizable, return the 0 vector. 
  // Normalizes to a vector of size mag, or 1 if undefined
  normalized: (a, mag) => {
    if (!mag) {
      if (mag !== 0) mag = 1;
      else return { x: 0, y: 0 };
    }
    let norm = vec.mag(a);
    return norm == 0 ? { x: 0, y: 0 } : vec.scalar(a, mag / norm);
  },

  negative: (a) => {
    return vec.scalar(a, -1);
  },

  dot: (a, b) => {
    return a.x * b.x + a.y * b.y;
  }
}