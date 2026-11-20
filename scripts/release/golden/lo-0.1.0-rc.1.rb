cask "lo" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0-rc.1"
  sha256 arm:   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
         intel: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

  url "https://github.com/withlo/lo/releases/download/v#{version}/Lo-#{version}-#{arch}.dmg"
  name "Lo"
  desc "Desktop app for reviewing GitHub pull requests"
  homepage "https://github.com/withlo/lo"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :ventura

  app "Lo.app"

  uninstall quit: "com.scornz.lo"

  zap trash: [
    "/private/var/folders/*/*/C/Lo",
    "~/.config/lo",
    "~/Library/Application Support/Lo",
    "~/Library/Caches/com.scornz.lo.ShipIt",
    "~/Library/Caches/lo-updater",
    "~/Library/Preferences/ByHost/com.scornz.lo.ShipIt.*.plist",
    "~/Library/Preferences/com.scornz.lo.plist",
    "~/Library/Saved Application State/com.scornz.lo.savedState",
  ]
end
