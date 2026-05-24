type DiscordUser = {
  id: string;
  username: string;
  discriminator?: string;
  bot?: boolean;
};

export async function validateBotToken(botToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bot ${botToken}`
    }
  });

  if (!response.ok) {
    throw new Error("Token invalido ou bot inacessivel");
  }

  const user = (await response.json()) as DiscordUser;

  if (!user.bot) {
    throw new Error("Token invalido ou bot inacessivel");
  }

  return user;
}
