import React from 'react';
import {
  Heading,
  Text,
  Card,
  Stack,
  Flex,
  Badge,
  SimpleGrid,
} from '@chakra-ui/react';
import Link from 'next/link';

export default function Home() {
  return (
    <Flex direction="column" gap="24px">
      <Stack gap={2} textAlign="center" py={6}>
        <Heading size="2xl">EinkHub Flash Tools</Heading>
        <Text color="grey" textStyle="lg">
          Web-based firmware tools for e-ink readers running{' '}
          <b>CrossPoint</b> open-source firmware. Back up, restore, and flash
          your device directly from the browser using the Web Serial API.
        </Text>
      </Stack>

      <Stack gap={2}>
        <Heading size="lg" textAlign="center">
          Select your device
        </Heading>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={6}>
          <Link href="/x3" style={{ textDecoration: 'none' }}>
            <Card.Root
              variant="outline"
              size="lg"
              cursor="pointer"
              _hover={{ borderColor: 'blue.500', shadow: 'md' }}
              transition="all 0.2s"
              height="100%"
            >
              <Card.Header>
                <Flex alignItems="center" gap={2}>
                  <Heading size="lg">Xteink X3</Heading>
                  <Badge colorPalette="blue" variant="solid" size="sm">
                    ESP32-C3
                  </Badge>
                </Flex>
              </Card.Header>
              <Card.Body>
                <Stack gap={2}>
                  <Text>
                    6-inch e-ink reader with physical buttons. Flash the latest
                    CrossPoint firmware with improved grayscale antialiasing.
                  </Text>
                  <Text textStyle="sm" color="grey">
                    Flash, backup, restore, and debug tools
                  </Text>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Link>

          <Link href="/papers3" style={{ textDecoration: 'none' }}>
            <Card.Root
              variant="outline"
              size="lg"
              cursor="pointer"
              _hover={{ borderColor: 'green.500', shadow: 'md' }}
              transition="all 0.2s"
              height="100%"
            >
              <Card.Header>
                <Flex alignItems="center" gap={2}>
                  <Heading size="lg">M5Stack Paper S3</Heading>
                  <Badge colorPalette="green" variant="solid" size="sm">
                    ESP32-S3
                  </Badge>
                </Flex>
              </Card.Header>
              <Card.Body>
                <Stack gap={2}>
                  <Text>
                    M5Stack touchscreen e-paper development board. Flash
                    CrossPoint PaperS3 community firmware.
                  </Text>
                  <Text textStyle="sm" color="grey">
                    Flash, backup, restore, and debug tools
                  </Text>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Link>
        </SimpleGrid>
      </Stack>

      <Card.Root variant="subtle">
        <Card.Body>
          <Stack gap={2}>
            <Heading size="md">How it works</Heading>
            <Stack gap={1} textStyle="sm" color="grey">
              <Text>
                This tool uses the <b>Web Serial API</b> to communicate with
                your device over USB. It requires <b>Chrome or Edge</b> —
                Safari, Firefox, and other browsers are not supported.
              </Text>
              <Text>
                Select your device above to access flash controls, full backup
                and restore, OTA fast flashing, and debug tools.
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Flex>
  );
}
