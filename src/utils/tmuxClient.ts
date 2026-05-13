import { shellQuote } from './shellQuote.js';

export const CURRENT_CLIENT_TTY_COMMAND = 'tmux display-message -p "#{client_tty}"';
export const CLIENT_ACTIVITY_COMMAND =
  'tmux list-clients -F "#{client_activity}\t#{client_tty}"';
export const CLIENT_KEY_TABLE_COMMAND =
  'tmux list-clients -F "#{client_tty}\t#{client_key_table}"';

export function parseContextualClientTty(output: string): string | null {
  const clientTty = output.trim();
  return clientTty || null;
}

export function parseMostRecentClientTty(output: string): string | null {
  const mostRecentClient = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [activity = '', clientTty = ''] = line.split('\t');
      return {
        activity: Number.parseInt(activity, 10) || 0,
        clientTty: clientTty.trim(),
      };
    })
    .filter((entry) => entry.clientTty.length > 0)
    .sort((left, right) => right.activity - left.activity)[0];

  return mostRecentClient?.clientTty || null;
}

export function parseClientKeyTable(
  clientsOutput: string,
  targetClientTty: string
): string | null {
  const matchingClient = clientsOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [clientTty = '', keyTable = ''] = line.split('\t');
      return {
        clientTty: clientTty.trim(),
        keyTable: keyTable.trim(),
      };
    })
    .find((client) => client.clientTty === targetClientTty);

  return matchingClient?.keyTable || null;
}

export function buildDetachClientCommand(targetClientTty: string): string {
  return `tmux detach-client -t ${shellQuote(targetClientTty)}`;
}

export function buildSwitchClientKeyTableCommand(
  keyTable: string,
  clientTty?: string
): string {
  const clientTarget = clientTty ? ` -c ${shellQuote(clientTty)}` : '';
  const keyTableTarget = keyTable === 'root' ? 'root' : shellQuote(keyTable);
  return `tmux switch-client${clientTarget} -T ${keyTableTarget}`;
}
