#!/usr/bin/env bash
# Run RELEASE-02 in a disposable Ubuntu cloud VM.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="${KVM_WORK_DIR:-$repo_root/.kvm-release}"
image="${KVM_IMAGE:-$work_dir/ubuntu-24.04-server-cloudimg-amd64.img}"
image_url="${KVM_IMAGE_URL:-https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img}"
version="${VERSION:-1.0.0}"
version="${version#v}"
deb="${DEB:-$repo_root/dist/keyboardeer_${version}_amd64.deb}"
ssh_key="$work_dir/id_ed25519"
seed="$work_dir/seed.iso"
overlay="$work_dir/acceptance.qcow2"
ssh_port="${KVM_SSH_PORT:-22229}"
http_port="${KVM_HTTP_PORT:-18080}"
vm_pid=""
http_pid=""

die() { printf 'KVM acceptance: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required (install qemu-system-x86, qemu-utils, genisoimage, and openssh-client)"; }
for tool in qemu-system-x86_64 qemu-img genisoimage ssh-keygen ssh curl python3; do
  need "$tool"
done

[[ -f "$deb" ]] || die "package not found at $deb; run scripts/package-linux-release.sh first"
mkdir -p "$work_dir"

if [[ ! -f "$image" ]]; then
  printf 'Downloading Ubuntu cloud image…\n'
  curl --fail --location --output "$image" "$image_url"
fi
if [[ ! -f "$ssh_key" ]]; then
  ssh-keygen -q -t ed25519 -N '' -f "$ssh_key"
fi

rm -f "$overlay" "$seed"
qemu-img create -f qcow2 -F qcow2 -b "$image" "$overlay" >/dev/null
pubkey="$(cat "$ssh_key.pub")"
cat > "$work_dir/user-data" <<EOF
#cloud-config
users:
  - name: keyboardeer
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: [adm, sudo]
    shell: /bin/bash
    ssh_authorized_keys:
      - $pubkey
package_update: true
packages:
  - curl
  - openssh-server
  - libgtk-3-0
  - libwebkit2gtk-4.1-0
  - desktop-file-utils
  - shared-mime-info
  - xdg-utils
runcmd:
  - touch /var/lib/cloud/instance/keyboardeer-ready
EOF
cat > "$work_dir/meta-data" <<EOF
instance-id: keyboardeer-release-acceptance
local-hostname: keyboardeer-release
EOF
genisoimage -quiet -output "$seed" -volid cidata -joliet -rock \
  "$work_dir/user-data" "$work_dir/meta-data"

cleanup() {
  [[ -n "$vm_pid" ]] && kill "$vm_pid" 2>/dev/null || true
  [[ -n "$http_pid" ]] && kill "$http_pid" 2>/dev/null || true
}
trap cleanup EXIT

python3 -m http.server "$http_port" --directory "$(dirname "$deb")" >/dev/null 2>&1 &
http_pid=$!
qemu-system-x86_64 \
  -name keyboardeer-release-acceptance \
  -machine accel=kvm:tcg \
  -m 3072 -smp 2 -cpu max \
  -drive "file=$overlay,if=virtio,format=qcow2" \
  -cdrom "$seed" -nographic \
  -nic "user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:$ssh_port-:22" \
  >/dev/null 2>&1 &
vm_pid=$!

ssh_opts=(-i "$ssh_key" -p "$ssh_port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=2)
printf 'Waiting for the VM…\n'
for _ in $(seq 1 120); do
  if ssh "${ssh_opts[@]}" keyboardeer@127.0.0.1 true >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
ssh "${ssh_opts[@]}" keyboardeer@127.0.0.1 true >/dev/null \
  || die "VM did not become reachable on SSH port $ssh_port"

printf 'Running clean-install acceptance checks…\n'
ssh "${ssh_opts[@]}" keyboardeer@127.0.0.1 bash -s -- "$version" "$http_port" "$deb" <<'GUEST'
set -euo pipefail
version="$1"
http_port="$2"
deb_path="$3"
deb_name="$(basename "$deb_path")"
for _ in $(seq 1 60); do
  if [[ -f /var/lib/cloud/instance/keyboardeer-ready ]]; then
    break
  fi
  sleep 2
done
curl --fail --output "/tmp/$deb_name" "http://10.0.2.2:$http_port/$deb_name"
sudo dpkg -i "/tmp/$deb_name" || {
  sudo apt-get update
  sudo apt-get -f install --yes
  sudo dpkg -i "/tmp/$deb_name"
}
test -x /usr/bin/keyboardeer
test -f /usr/share/applications/keyboardeer.desktop
test -f /usr/share/mime/packages/keyboardeer-kbdprofile.xml
grep -q 'application/x-keyboardeer-profile=keyboardeer.desktop' /usr/share/applications/mimeapps.list
desktop-file-validate /usr/share/applications/keyboardeer.desktop
update-mime-database /usr/share/mime
grep -q 'kbdprofile.json' /usr/share/mime/packages/keyboardeer-kbdprofile.xml

# Upgrade the same installation and verify the association survives.
sudo dpkg -i "/tmp/$deb_name"
grep -q 'application/x-keyboardeer-profile=keyboardeer.desktop' /usr/share/applications/mimeapps.list

sudo apt-get purge --yes keyboardeer
test ! -e /usr/bin/keyboardeer
test ! -e /usr/share/applications/keyboardeer.desktop
test ! -e /usr/share/mime/packages/keyboardeer-kbdprofile.xml
echo 'KVM release acceptance passed.'
GUEST

printf 'KVM release acceptance passed.\n'
