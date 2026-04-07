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

export default function HeaderBar() {
  const pathname = usePathname();
  return (
    <Box bg="header-bar.bg" px={4}>
      <Container maxW="3xl">
        <Flex h={16} alignItems="center" gap={5}>
          <Heading size="md" color="header-bar.fg">
            <Link href="/">EinkHub Flash Tools</Link>
          </Heading>
          <Flex h={16} alignItems="center" gap={2}>
            <Text textStyle="sm">
              <Link href="/">{pathname === '/' ? <b>Flash</b> : 'Flash'}</Link>
            </Text>
            <Text textStyle="sm">
              <Link href="/debug">
                {pathname === '/debug' ? <b>Debug</b> : 'Debug'}
              </Link>
            </Text>
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
