'use client';

import React from 'react';
import {
  Box,
  ClientOnly,
  Container,
  Flex,
  Heading,
  IconButton,
  Spacer,
  Text,
} from '@chakra-ui/react';
import { ColorModeButton } from '@/components/ui/color-mode';
import { LuGithub, LuSun } from 'react-icons/lu';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Every device with a page of its own, and the pages the bar offers for it.
// The two ESP32 devices have a Flash page and a Debug page; the Kobo Libra 2
// has one page, because it is flashed over its own bootloader and there is no
// serial port behind it to debug. So its nav is the one entry rather than a
// pair, and the bar names the device either way.
const DEVICES = [
  {
    base: '/x3',
    label: 'Xteink X3',
    pages: [
      { href: '/x3', label: 'Flash' },
      { href: '/x3/debug', label: 'Debug' },
    ],
  },
  {
    base: '/papers3',
    label: 'Paper S3',
    pages: [
      { href: '/papers3', label: 'Flash' },
      { href: '/papers3/debug', label: 'Debug' },
    ],
  },
  {
    base: '/kobo-libra2',
    label: 'Kobo Libra 2',
    pages: [{ href: '/kobo-libra2', label: 'Install' }],
  },
];

export default function HeaderBar() {
  const pathname = usePathname();

  // Determine the device context from the URL
  const device = DEVICES.find((d) => pathname.startsWith(d.base));

  return (
    <Box bg="header-bar.bg" px={4}>
      <Container maxW="3xl">
        <Flex h={16} alignItems="center" gap={5}>
          <Heading size="md" color="header-bar.fg">
            <Link href="/">EinkHub</Link>
          </Heading>
          <Flex h={16} alignItems="center" gap={2}>
            {device ? (
              <>
                <Text textStyle="sm" color="header-bar.fg" fontWeight="bold">
                  {device.label}
                </Text>
                {device.pages.map((page) => (
                  <Text key={page.href} textStyle="sm">
                    <Link href={page.href}>
                      {pathname === page.href ? (
                        <b>{page.label}</b>
                      ) : (
                        page.label
                      )}
                    </Link>
                  </Text>
                ))}
              </>
            ) : (
              <Text textStyle="sm" color="header-bar.fg">
                Select a device to get started
              </Text>
            )}
          </Flex>
          <Spacer />

          <Flex alignItems="center" gap={2}>
            <IconButton
              size="sm"
              variant="outline"
              onClick={() =>
                window.open(
                  'https://github.com/juicecultus/crosspoint-reader-papers3-flasher',
                  '_blank',
                )
              }
              css={{
                _icon: {
                  width: '5',
                  height: '5',
                },
              }}
              aria-label="Go to Github repo"
            >
              <LuGithub />
            </IconButton>
            <ClientOnly
              fallback={
                <IconButton
                  size="sm"
                  variant="outline"
                  css={{
                    _icon: {
                      width: '5',
                      height: '5',
                    },
                  }}
                >
                  <LuSun />
                </IconButton>
              }
            >
              <ColorModeButton variant="outline" />
            </ClientOnly>
          </Flex>
        </Flex>
      </Container>
    </Box>
  );
}
