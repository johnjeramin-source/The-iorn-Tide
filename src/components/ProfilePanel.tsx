import React, { useEffect, useRef, useState } from 'react';
import {
  AVATAR_COUNT,
  DEFAULT_AVATAR,
  PlayerProfile,
  PROFILE_COLORS,
  loadProfile,
  rankFor,
  rankProgress,
  saveProfile,
} from '../game/profile';

const avatarPath = (index: number) => `/avatars/avatar-${index}.${index === 1 ? "png" : "svg"}`;
const builtinIndex = (avatar: string): number => {
  const match = /^builtin:(\d+)$/.exec(avatar);
  return match ? Math.max(1, Math.min(AVATAR_COUNT, Number(match[1]))) : 1;
};

interface PlayerAvatarProps {
  avatar: string;
  color: string;
  size?: number;
  className?: string;
  cartoonFilter?: boolean;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatar, color, size = 38, className = '', cartoonFilter = false,
}) => {
  const index = builtinIndex(avatar);
  const isUploaded = avatar.startsWith('data:image/');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatar]);
  const source = isUploaded && !failed ? avatar : failed ? `/avatars/avatar-${index}.svg` : avatarPath(index);
  return (
    <span
      className={`player-avatar-frame relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, borderColor: color, boxShadow: `0 0 0 2px ${color}55, 0 0 12px ${color}44` }}
    >
      <img
        src={source}
        alt="Player avatar"
        draggable={false}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${cartoonFilter ? 'player-avatar-cartoon' : ''}`}
      />
      <span className="player-avatar-star" aria-hidden="true">★</span>
    </span>
  );
};

const StatCard: React.FC<{ icon: string; label: string; value: string | number }> = ({ icon, label, value }) => (
  <div className="profile-stat-card">
    <span className="profile-stat-icon" aria-hidden="true">{icon}</span>
    <span className="profile-stat-label">{label}</span>
    <strong className="profile-stat-value">{value}</strong>
  </div>
);

async function photoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not read this image.'));
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = Math.max(0, (image.naturalWidth - side) / 2);
    const sy = Math.max(0, (image.naturalHeight - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo editing is unavailable on this device.');
    context.drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
    let result = canvas.toDataURL('image/webp', 0.78);
    if (!result.startsWith('data:image/webp')) result = canvas.toDataURL('image/jpeg', 0.76);
    let quality = 0.68;
    while (result.length > 132_000 && quality >= 0.35) {
      result = canvas.toDataURL('image/jpeg', quality);
      quality -= 0.08;
    }
    if (result.length > 132_000) throw new Error('This photo is too complex to save under 100 KB. Try another photo.');
    return result;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const ProfileChip: React.FC = () => {
  const [profile, setProfile] = useState<PlayerProfile>(() => loadProfile());
  const [draft, setDraft] = useState<PlayerProfile>(() => loadProfile());
  const [open, setOpen] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [saveError, setSaveError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const draftProgress = rankProgress(draft.totalKills);
  const hours = Math.floor(profile.secondsPlayed / 3600);
  const mins = Math.floor((profile.secondsPlayed % 3600) / 60);

  const update = (patch: Partial<PlayerProfile>) => setDraft((current) => ({ ...current, ...patch }));
  const saveAndClose = () => {
    if (!saveProfile(draft)) {
      setSaveError('Storage is full or unavailable. Your changes remain open; try a smaller photo.');
      return;
    }
    setProfile(draft);
    window.dispatchEvent(new Event('irontide-profile-updated'));
    setOpen(false);
    setSaveError('');
  };
  const choosePhoto = async (file?: File) => {
    if (!file) return;
    setPhotoError('');
    try {
      const avatar = await photoToDataUrl(file);
      update({ avatar });
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Could not save this photo.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const latest = loadProfile();
          setProfile(latest);
          setDraft(latest);
          setPhotoError('');
          setSaveError('');
          setOpen(true);
        }}
        className="profile-chip pointer-events-auto absolute top-[calc(env(safe-area-inset-top)+10px)] right-[calc(env(safe-area-inset-right)+10px)] z-30 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left"
        aria-label="Open player profile"
      >
        <PlayerAvatar avatar={profile.avatar} color={profile.color} size={34} />
        <span className="min-w-0 leading-tight">
          <span className="block max-w-[135px] truncate text-xs font-black text-slate-100">{profile.callsign}</span>
          <span className="block text-[10px] font-bold text-amber-300">{rankFor(profile.totalKills)} ★</span>
        </span>
      </button>

      {open && (
        <div
          className="profile-overlay pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center"
          role="dialog" aria-modal="true" aria-label="Player profile"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <section className="profile-card" aria-label="Military identification and service record">
            <header className="profile-heading">
              <div>
                <div className="profile-kicker">COASTAL VANGUARD · PERSONNEL RECORD</div>
                <h2>PLAYER PROFILE</h2>
              </div>
              <span className="profile-id-tag">IT // PERSONNEL</span>
            </header>

            <div className="profile-content">
              <div className="profile-identity-column">
                <div className="profile-identity-card">
                  <PlayerAvatar avatar={draft.avatar} color={draft.color} size={92} cartoonFilter={draft.cartoonFilter} className="profile-large-avatar"/>
                  <div className="profile-rank-star" aria-label="Rank star">★</div>
                  <div className="profile-call-sign">{draft.callsign || 'Vanguard'}</div>
                  <div className="profile-rank-name">{rankFor(draft.totalKills).toUpperCase()}</div>
                  <div className="profile-rank-track"><span style={{ width: `${draftProgress.percent}%` }}/></div>
                  <div className="profile-rank-caption">
                    <span>{draft.totalKills.toLocaleString()} KILLS</span>
                    <span>{draftProgress.nextName === rankFor(draft.totalKills) ? 'MAX RANK' : `NEXT: ${draftProgress.nextName.toUpperCase()}`}</span>
                  </div>
                </div>

                <label className="profile-field-label" htmlFor="profile-callsign">CALLSIGN</label>
                <input
                  id="profile-callsign"
                  value={draft.callsign}
                  maxLength={14}
                  onChange={(event) => update({ callsign: event.target.value.replace(/[<>]/g, '').trimStart() || 'Vanguard' })}
                  className="profile-input"
                />

                <div className="profile-section-label">IDENTIFICATION COLOR</div>
                <div className="profile-color-row">
                  {PROFILE_COLORS.map((color) => (
                    <button key={color} type="button" aria-label={`Choose player color ${color}`}
                      aria-pressed={draft.color === color}
                      onClick={() => update({ color })}
                      className={`profile-color-swatch ${draft.color === color ? 'selected' : ''}`}
                      style={{ backgroundColor: color }}/>
                  ))}
                </div>
              </div>

              <div className="profile-stats-column">
                <div className="profile-section-heading">SERVICE RECORD <span>FIELD STATISTICS</span></div>
                <div className="profile-stats-grid">
                  <StatCard icon="⚑" label="Missions" value={draft.missions}/>
                  <StatCard icon="✚" label="Victories" value={draft.victories}/>
                  <StatCard icon="☠" label="Total kills" value={draft.totalKills.toLocaleString()}/>
                  <StatCard icon="★" label="Best run" value={draft.bestKills.toLocaleString()}/>
                  <StatCard icon="◷" label="Time played" value={`${hours}h ${mins}m`}/>
                  <StatCard icon="⌖" label="Win rate" value={`${draft.missions ? Math.round(draft.victories / draft.missions * 100) : 0}%`}/>
                </div>

                <div className="profile-section-heading profile-avatar-heading">AVATAR LOADOUT <span>SELECT PERSONNEL PORTRAIT</span></div>
                <div className="profile-avatar-tools">
                  <div className="profile-avatar-grid">
                    {Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1).map((index) => (
                      <button key={index} type="button" aria-label={`Select cartoon avatar ${index}`}
                        aria-pressed={draft.avatar === `builtin:${index}`}
                        onClick={() => update({ avatar: `builtin:${index}` })}
                        className={`profile-avatar-choice ${draft.avatar === `builtin:${index}` ? 'selected' : ''}`}>
                        <img src={avatarPath(index)} onError={(event) => { event.currentTarget.src = `/avatars/avatar-${index}.svg`; }}
                          alt="" draggable={false}/>
                      </button>
                    ))}
                  </div>
                  <div className="profile-avatar-actions">
                    <button type="button" className="profile-tool-button" onClick={() => fileInput.current?.click()}>
                      <span>▣</span> TAKE / CHOOSE PHOTO
                    </button>
                    <input ref={fileInput} type="file" accept="image/*" className="hidden"
                      onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.currentTarget.value = ''; }}/>
                    <label className="profile-filter-toggle">
                      <input type="checkbox" checked={draft.cartoonFilter} onChange={(event) => update({ cartoonFilter: event.target.checked })}/>
                      <span>CARTOON FILTER</span>
                    </label>
                    <button type="button" className="profile-reset-button" onClick={() => update({ avatar: DEFAULT_AVATAR })}>↺ RESET AVATAR</button>
                  </div>
                </div>
                {photoError && <p className="profile-error" role="alert">{photoError}</p>}
                {saveError && <p className="profile-error" role="alert">{saveError}</p>}
              </div>
            </div>

            <footer className="profile-footer">
              <span>IRON TIDE // PERSONNEL COMMAND</span>
              <button type="button" onClick={saveAndClose} className="profile-save-button">✓ SAVE &amp; CLOSE</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};
