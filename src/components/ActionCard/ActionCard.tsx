'use client';

import React from 'react';
import { Box, Card, Heading, HStack, Stack, Text } from '@chakra-ui/react';

const ACCENTS = {
  default: 'border',
  primary: 'blue.solid',
  warning: 'orange.solid',
};

/**
 * Section card with a leading icon, title, description, and body slot.
 * Keeps every card visually consistent: same padding, border, gap.
 */
export default function ActionCard({
  icon,
  title,
  description,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'primary' | 'warning';
}) {
  const accent = ACCENTS[tone];
  return (
    <Card.Root variant="outline" borderColor={accent} borderLeftWidth="3px">
      <Card.Body>
        <Stack gap={4}>
          <Stack gap={1}>
            <HStack gap={2} alignItems="center">
              <Box color={accent} display="inline-flex" fontSize="lg">
                {icon}
              </Box>
              <Heading size="md">{title}</Heading>
            </HStack>
            {description && (
              <Text color="fg.muted" textStyle="sm">
                {description}
              </Text>
            )}
          </Stack>
          {children}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
