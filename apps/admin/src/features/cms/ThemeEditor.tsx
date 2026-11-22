import { useState, type CSSProperties } from 'react';
import {
  DEFAULT_SITE_THEME,
  SITE_THEME_PRESETS,
  SiteThemeShapeSchema,
  THEME_MIN_CONTRAST,
  deriveThemePalette,
  hexColorSchema,
  themeContrastPairs,
  type SiteTheme,
} from '@afhomes/contracts';
import { Button, Icon, TextField } from '@afhomes/ui';
import styles from './ThemeEditor.module.css';

const COLOURS: { key: keyof SiteTheme; label: string; hint: string }[] = [
  { key: 'primary', label: 'Primary', hint: 'Buttons, links and green accents.' },
  { key: 'accent', label: 'Accent', hint: 'Badges and highlights.' },
  { key: 'background', label: 'Background', hint: 'Page background and light cards.' },
  { key: 'text', label: 'Text', hint: 'Headings and body text.' },
  { key: 'dark', label: 'Dark sections', hint: 'Dark bands and the footer.' },
];

/** The stored theme if it is well-formed (contrast aside), so a failing draft stays editable. */
function readTheme(value: unknown): SiteTheme | undefined {
  const parsed = SiteThemeShapeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const same = (a: SiteTheme, b: SiteTheme) => COLOURS.every(({ key }) => a[key] === b[key]);

function ColourRow({
  id,
  label,
  hint,
  colour,
  disabled,
  onPick,
}: {
  id: string;
  label: string;
  hint: string;
  colour: string;
  disabled: boolean;
  onPick: (hex: string) => void;
}) {
  const [text, setText] = useState(colour);
  // Follow outside changes (picker, preset, reset) without an effect: adjust during render.
  const [shown, setShown] = useState(colour);
  if (shown !== colour) {
    setShown(colour);
    if (hexColorSchema.safeParse(text.trim()).data !== colour) setText(colour);
  }
  const valid = hexColorSchema.safeParse(text);
  return (
    <div className={styles.row}>
      <input
        type="color"
        className={styles.swatch}
        aria-label={`${label} colour picker`}
        value={colour}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
      />
      <TextField
        id={id}
        name={id}
        label={label}
        hint={hint}
        value={text}
        disabled={disabled}
        error={valid.success || text === '' ? undefined : 'Use a hex colour such as #57ab4b.'}
        onChange={(next) => {
          setText(next);
          const parsed = hexColorSchema.safeParse(next.trim());
          if (parsed.success) onPick(parsed.data);
        }}
      />
    </div>
  );
}

export function ThemeEditor({
  value,
  onChange,
  disabled,
}: {
  value: unknown;
  onChange: (theme: SiteTheme | undefined) => void;
  disabled: boolean;
}) {
  const stored = readTheme(value);
  const theme = stored ?? DEFAULT_SITE_THEME;
  const pairs = themeContrastPairs(theme);
  const failing = pairs.some((p) => p.ratio < THEME_MIN_CONTRAST);
  const preview = deriveThemePalette(theme) as CSSProperties;
  return (
    <fieldset className={styles.theme} disabled={disabled} id="cms-site-theme">
      <legend>Theme &amp; colours</legend>
      <p className={styles.lede}>
        Pick five brand colours. Every lighter and darker shade on the public website is derived
        from them. Changes reach the website only when you publish.
      </p>
      {!stored && <p className={styles.note}>Using the AF Homes default colours.</p>}

      <div className={styles.presets} role="group" aria-label="Preset palettes">
        {SITE_THEME_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={styles.preset}
            aria-pressed={same(preset.theme, theme)}
            onClick={() => onChange(preset.theme)}
          >
            <span className={styles.dots} aria-hidden="true">
              {COLOURS.map(({ key }) => (
                <span key={key} style={{ background: preset.theme[key] }} />
              ))}
            </span>
            {preset.name}
          </button>
        ))}
      </div>

      <div className={styles.layout}>
        <div className={styles.colours}>
          {COLOURS.map(({ key, label, hint }) => (
            <ColourRow
              key={key}
              id={`cms-theme-${key}`}
              label={label}
              hint={hint}
              colour={theme[key]}
              disabled={disabled}
              onPick={(hex) => onChange({ ...theme, [key]: hex })}
            />
          ))}
          <Button
            variant="secondary"
            disabled={disabled || !stored}
            onClick={() => onChange(undefined)}
          >
            Reset to AF Homes default
          </Button>
        </div>

        <div className={styles.preview} style={preview} aria-label="Theme preview">
          <div className={styles.hero}>
            <span className={styles.badge}>VIP Privilege</span>
            <strong>Live well, naturally.</strong>
          </div>
          <div className={styles.body}>
            <strong className={styles.heading}>AF Homes Ecofarm</strong>
            <p className={styles.text}>Wellness stays, dining and resort privileges.</p>
            <p className={styles.muted}>Secondary text looks like this.</p>
            <span className={styles.button}>Explore experiences</span>
          </div>
        </div>
      </div>

      <div role="status" className={styles.contrast}>
        <p className={failing ? styles.fail : styles.pass}>
          <Icon name={failing ? 'alert' : 'check'} size={16} />
          {failing
            ? 'Fix the colours marked below before saving.'
            : 'All text is readable (WCAG AA).'}
        </p>
        <ul>
          {pairs.map((p) => {
            const ok = p.ratio >= THEME_MIN_CONTRAST;
            return (
              <li key={p.pair} className={ok ? styles.pass : styles.fail}>
                <span>{p.pair}</span>
                <span>
                  {p.ratio.toFixed(2)}:1 · {ok ? 'Readable' : 'Too low'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </fieldset>
  );
}
