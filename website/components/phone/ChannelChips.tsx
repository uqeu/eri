// A small row of channel chips under the phone: eri shows up wherever you
// already text, because the phone half runs on Spectrum. Each chip is just a
// logo + the channel name — no status dots, no badges, tasteful and quiet.

interface Channel {
  readonly logo: string;
  readonly name: string;
}

const CHANNELS: ReadonlyArray<Channel> = [
  { logo: "imessage", name: "iMessage" },
  { logo: "whatsapp", name: "WhatsApp" },
  { logo: "telegram", name: "Telegram" },
  { logo: "slack", name: "Slack" },
  { logo: "discord", name: "Discord" },
];

export function ChannelChips(): React.ReactElement {
  return (
    <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center gap-4">
      <div className="chchips">
        {CHANNELS.map((c) => (
          <span key={c.name} className="chchip">
            <img
              src={`/logos/${c.logo}.svg`}
              alt=""
              aria-hidden
              loading="lazy"
              className="chchip__logo"
            />
            {c.name}
          </span>
        ))}
      </div>
      <p className="text-center font-geist text-[14px] leading-snug text-[#86868b]">
        One eri, every inbox. It shows up wherever you already text.
      </p>
    </div>
  );
}
