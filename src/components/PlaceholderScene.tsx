'use client';

import { useThree } from '@react-three/fiber';

export function PlaceholderScene() {
  const { scene } = useThree();

  return (
    <>
      <ambientLight intensity={0.5} />
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="gray" />
      </mesh>
    </>
  );
}