import React from 'react';
import { Text } from '@chakra-ui/react';

export default function VersionMeta({
  version,
  releaseDate,
}: {
  version?: string;
  releaseDate?: string;
}) {
  return (
    <Text color="fg.muted" textStyle="xs">
      {version || 'Loading…'}
      {releaseDate ? ` · released ${releaseDate}` : ''}
    </Text>
  );
}
