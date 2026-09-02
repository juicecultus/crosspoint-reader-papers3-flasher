'use client';

import React, { useState } from 'react';
import { Box, Button, Stack } from '@chakra-ui/react';
import { LuChevronDown, LuChevronRight } from 'react-icons/lu';

/**
 * Lightweight disclosure with chevron, used for "Other install options",
 * the bottom "Help & safety" accordion, and the Libra 2 page's asides.
 */
export default function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Stack gap={2}>
      <Button
        variant="ghost"
        size="sm"
        justifyContent="flex-start"
        onClick={() => setOpen((o) => !o)}
        color="fg.muted"
        px={2}
      >
        <Box as="span" mr={1} display="inline-flex">
          {open ? <LuChevronDown /> : <LuChevronRight />}
        </Box>
        {label}
      </Button>
      {open && <Box pl={6}>{children}</Box>}
    </Stack>
  );
}
