export const MANAGED_INSTALL_REPO = "silviobeer/beerengineer"
export const MANAGED_INSTALL_POSIX_COMMAND = "curl -fsSL https://github.com/silviobeer/beerengineer/releases/latest/download/install.sh | sh"
export const MANAGED_INSTALL_WINDOWS_COMMAND = "irm https://github.com/silviobeer/beerengineer/releases/latest/download/install.ps1 | iex"

export const MANAGED_INSTALL_PREREQUISITES = ["Node.js 22+", "npm", "Git"]

export function managedInstallManualRemovalNotes(): string[] {
  return [
    "v1 does not provide an uninstall command.",
    "Manual removal means deleting the managed install root under the beerengineer data directory, the beerengineer config file, and the SQLite database only after backing up anything you need.",
  ]
}
