'use client';
import { useState } from 'react';
export function Reserve() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>Reserve ({n})</button>;
}
