import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export const BG = "#0A0A0A";
export const FG = "#F5F2EC";
export const ACCENT = "#E0FF4F";
export const MUTED = "#8A8780";

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen-Sans, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif";

const bodyStyle: React.CSSProperties = {
  backgroundColor: BG,
  color: FG,
  fontFamily: FONT_STACK,
  margin: 0,
  padding: "32px 0",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: BG,
  border: "1px solid #1E1E1E",
  borderRadius: 8,
  margin: "0 auto",
  maxWidth: 560,
  padding: 32,
  width: "100%",
};

const footerTextStyle: React.CSSProperties = {
  color: MUTED,
  fontSize: 12,
  lineHeight: "18px",
  margin: 0,
};

const footerLinkStyle: React.CSSProperties = {
  color: MUTED,
  textDecoration: "underline",
};

const dividerStyle: React.CSSProperties = {
  borderColor: "#1E1E1E",
  margin: "32px 0 16px",
};

export interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl?: string;
}

export function EmailLayout({
  preview,
  children,
  unsubscribeUrl,
}: EmailLayoutProps): React.ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          {children}
          <Hr style={dividerStyle} />
          <Section>
            <Text style={footerTextStyle}>
              eri — Voice-first diffusion IDE
            </Text>
            {unsubscribeUrl ? (
              <Text style={footerTextStyle}>
                <Link href={unsubscribeUrl} style={footerLinkStyle}>
                  Unsubscribe
                </Link>
              </Text>
            ) : (
              <Text style={footerTextStyle}>
                This is a transactional message related to your account.
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const headingStyle: React.CSSProperties = {
  color: FG,
  fontSize: 24,
  fontWeight: 600,
  lineHeight: "32px",
  margin: "0 0 16px",
};

export const paragraphStyle: React.CSSProperties = {
  color: FG,
  fontSize: 15,
  lineHeight: "24px",
  margin: "0 0 16px",
};

export const buttonStyle: React.CSSProperties = {
  backgroundColor: ACCENT,
  borderRadius: 6,
  color: "#0A0A0A",
  display: "inline-block",
  fontSize: 15,
  fontWeight: 600,
  padding: "12px 20px",
  textDecoration: "none",
};

export const fallbackUrlStyle: React.CSSProperties = {
  color: MUTED,
  fontSize: 12,
  lineHeight: "20px",
  margin: "16px 0 0",
  wordBreak: "break-all",
};
