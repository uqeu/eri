import * as React from "react";
import { Button, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export interface WelcomeEmailProps {
  displayName?: string;
  downloadUrl: string;
  unsubscribeUrl: string;
}

export function WelcomeEmail({
  displayName,
  downloadUrl,
  unsubscribeUrl,
}: WelcomeEmailProps): React.ReactElement {
  const greeting = displayName ? `Welcome, ${displayName}.` : "Welcome to eri.";
  return (
    <EmailLayout
      preview="Welcome to eri — your voice-first diffusion IDE."
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section>
        <Text style={headingStyle}>{greeting}</Text>
        <Text style={paragraphStyle}>
          eri is a voice-first diffusion IDE. Speak the change you want, watch
          the editor type it back. Your gaze tells eri where to look; your
          voice tells it what to do.
        </Text>
        <Text style={paragraphStyle}>
          Tip: open the command palette and try saying{" "}
          <b>&quot;refactor this function to be async&quot;</b> while looking
          at the symbol. eri will plan the diff before applying it.
        </Text>
        <Button href={downloadUrl} style={buttonStyle}>
          Download eri
        </Button>
      </Section>
    </EmailLayout>
  );
}

WelcomeEmail.PreviewProps = {
  displayName: "Khai",
  downloadUrl: "https://eri.dev/download",
  unsubscribeUrl: "https://eri.dev/unsubscribe?token=preview",
} satisfies WelcomeEmailProps;

export default WelcomeEmail;
