import React from 'react';
import type { Metadata } from 'next';

// The page itself is a client component, because everything on it is a browser
// API: WebUSB, DecompressionStream and Web Crypto. Metadata cannot live there,
// so it lives here, in the words the installer's own <head> carried.
export const metadata: Metadata = {
  title: 'Put InkHub on a Kobo Libra 2',
  description:
    'Put InkHub on a Kobo Libra 2 from Chrome or Edge, or try the whole system from memory without writing anything to the device.',
};

export default function KoboLibra2Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
