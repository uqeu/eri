import * as React from "react";
import { Button, Section, Text } from "@react-email/components";
import {
  EmailLayout,
  buttonStyle,
  fallbackUrlStyle,
  headingStyle,
  paragraphStyle,
} from "./_layout";

export interface PasswordResetEmailProps {
  resetUrl: string;
}

export function PasswordResetEmail({
  resetUrl,
}: PasswordResetEmailProps): React.ReactElement {
  return (
    <EmailLayout preview="Reset your eri password (expires in 1 hour).">
      <Section>
        <Text style={headingStyle}>Reset your eri password</Text>
        <Text style={paragraphStyle}>
          Someone — hopefully you — asked to reset the password on your eri
          account. Click the button below to choose a new one. This link
          expires in <b>1 hour</b>.
        </Text>
        <Button href={resetUrl} style={buttonStyle}>
          Reset password
        </Button>
        <Text style={fallbackUrlStyle}>
          If the button does not work, paste this URL into your browser:
          <br />
          {resetUrl}
        </Text>
        <Text style={paragraphStyle}>
          If you did not request a password reset, you can ignore this email
          and your password will stay the same.
        </Text>
      </Section>
    </EmailLayout>
  );
}

PasswordResetEmail.PreviewProps = {
  resetUrl: "https://www.tryeri.ca/reset?token=preview",
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
