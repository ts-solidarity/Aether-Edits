import { useProject } from '../../state/ProjectContext';
import type { Clip, ColorAdjust, TextClip, TransitionKind, VideoClip, VideoFit } from '../../types/project';
import { DEFAULT_TRANSFORM, NEUTRAL_COLOR } from '../../types/project';

const DEFAULT_TRANSITION_DURATION = 1;

export function Inspector() {
  const { state, dispatch } = useProject();
  if (state.selectedClipIds.length !== 1) {
    return (
      <div>
        <div className="sidebar-section-title">Inspector</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
          Select a clip to edit its properties.
        </div>
      </div>
    );
  }
  const clip = state.clips[state.selectedClipIds[0]];
  if (!clip) return null;

  return (
    <div>
      <div className="sidebar-section-title">Inspector</div>
      <div className="inspector">
        <div className="inspector-header">
          <span className="inspector-kind">{clip.kind === 'video' ? '🎬 Video clip' : '🅣 Text clip'}</span>
        </div>
        {clip.kind === 'video' ? (
          <VideoClipFields clip={clip} dispatch={dispatch} />
        ) : (
          <TextClipFields clip={clip} dispatch={dispatch} />
        )}
        {(clip.kind === 'text' || (clip.kind === 'video' && clip.fit === 'free')) && (
          <TransformFields clip={clip} dispatch={dispatch} />
        )}
        {clip.kind === 'video' && (
          <ColorFields clip={clip} dispatch={dispatch} />
        )}
        <TransitionFields clip={clip} dispatch={dispatch} />
      </div>
    </div>
  );
}

function VideoClipFields({
  clip,
  dispatch,
}: {
  clip: VideoClip;
  dispatch: React.Dispatch<import('../../state/actions').Action>;
}) {
  const { state } = useProject();
  const fits: VideoFit[] = ['contain', 'cover', 'free'];
  // Other video clips that could serve as a duck source.
  const duckSources = Object.values(state.clips)
    .filter((c): c is VideoClip => c.kind === 'video' && c.id !== clip.id)
    .sort((a, b) => a.timelineStart - b.timelineStart);

  return (
    <>
      <label className="inspector-field">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(clip.volume * 100)}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_VOLUME',
              payload: { clipId: clip.id, volume: Number(e.target.value) / 100 },
            })
          }
        />
        <span className="inspector-value">{Math.round(clip.volume * 100)}%</span>
      </label>
      <label className="inspector-field">
        <span>Mute</span>
        <input
          type="checkbox"
          checked={clip.muted}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_MUTED',
              payload: { clipId: clip.id, muted: e.target.checked },
            })
          }
        />
      </label>
      <label className="inspector-field">
        <span>Pan</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={clip.pan}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_PAN',
              payload: { clipId: clip.id, pan: Number(e.target.value) },
            })
          }
        />
        <span className="inspector-value">
          {clip.pan === 0 ? 'C' : clip.pan < 0 ? `L${Math.round(-clip.pan * 100)}` : `R${Math.round(clip.pan * 100)}`}
        </span>
      </label>
      <div className="inspector-field inspector-field-stack">
        <span>Fit</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {fits.map((f) => (
            <button
              key={f}
              type="button"
              className={`inspector-chip ${clip.fit === f ? 'active' : ''}`}
              onClick={() =>
                dispatch({
                  type: 'SET_CLIP_FIT',
                  payload: { clipId: clip.id, fit: f },
                })
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-field-group-header">
        <span>Duck under</span>
      </div>
      <label className="inspector-field">
        <span>Source</span>
        <select
          value={clip.duckSourceClipId ?? ''}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_DUCK',
              payload: {
                clipId: clip.id,
                sourceClipId: e.target.value || null,
                amount: clip.duckAmount,
              },
            })
          }
        >
          <option value="">(off)</option>
          {duckSources.map((s) => {
            const trackName = state.tracks[s.trackId]?.name ?? s.trackId;
            const mediaName = state.mediaFiles[s.mediaFileId]?.name ?? s.id;
            return (
              <option key={s.id} value={s.id}>
                {trackName} · {mediaName} @ {s.timelineStart.toFixed(1)}s
              </option>
            );
          })}
        </select>
      </label>
      {clip.duckSourceClipId && (
        <label className="inspector-field">
          <span>Amount</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={clip.duckAmount}
            onChange={(e) =>
              dispatch({
                type: 'SET_CLIP_DUCK',
                payload: {
                  clipId: clip.id,
                  sourceClipId: clip.duckSourceClipId,
                  amount: Number(e.target.value),
                },
              })
            }
          />
          <span className="inspector-value">−{Math.round(clip.duckAmount * 100)}%</span>
        </label>
      )}
    </>
  );
}

function TextClipFields({
  clip,
  dispatch,
}: {
  clip: TextClip;
  dispatch: React.Dispatch<import('../../state/actions').Action>;
}) {
  return (
    <>
      <label className="inspector-field inspector-field-stack">
        <span>Text</span>
        <input
          type="text"
          value={clip.text}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_TEXT_CLIP',
              payload: { clipId: clip.id, text: e.target.value },
            })
          }
        />
      </label>
      <label className="inspector-field">
        <span>Color</span>
        <input
          type="color"
          value={clip.color}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_TEXT_CLIP',
              payload: { clipId: clip.id, color: e.target.value },
            })
          }
        />
      </label>
      <label className="inspector-field">
        <span>Size</span>
        <input
          type="range"
          min={2}
          max={25}
          step={0.5}
          value={clip.fontSize}
          onChange={(e) =>
            dispatch({
              type: 'UPDATE_TEXT_CLIP',
              payload: { clipId: clip.id, fontSize: Number(e.target.value) },
            })
          }
        />
        <span className="inspector-value">{clip.fontSize.toFixed(1)}%</span>
      </label>
    </>
  );
}

function TransformFields({
  clip,
  dispatch,
}: {
  clip: Clip;
  dispatch: React.Dispatch<import('../../state/actions').Action>;
}) {
  const t = clip.transform;
  const reset = () =>
    dispatch({
      type: 'SET_CLIP_TRANSFORM',
      payload: { clipId: clip.id, transform: { ...DEFAULT_TRANSFORM } },
    });

  return (
    <>
      <div className="inspector-field-group-header">
        <span>Transform</span>
        <button type="button" className="inspector-link-btn" onClick={reset}>
          Reset
        </button>
      </div>
      <label className="inspector-field">
        <span>X</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={t.x}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_TRANSFORM',
              payload: { clipId: clip.id, transform: { x: Number(e.target.value) } },
            })
          }
        />
        <span className="inspector-value">{Math.round(t.x * 100)}%</span>
      </label>
      <label className="inspector-field">
        <span>Y</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={t.y}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_TRANSFORM',
              payload: { clipId: clip.id, transform: { y: Number(e.target.value) } },
            })
          }
        />
        <span className="inspector-value">{Math.round(t.y * 100)}%</span>
      </label>
      <label className="inspector-field">
        <span>Scale</span>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={t.scale}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_TRANSFORM',
              payload: { clipId: clip.id, transform: { scale: Number(e.target.value) } },
            })
          }
        />
        <span className="inspector-value">{t.scale.toFixed(2)}×</span>
      </label>
      <label className="inspector-field">
        <span>Rotate</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={t.rotation}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_TRANSFORM',
              payload: { clipId: clip.id, transform: { rotation: Number(e.target.value) } },
            })
          }
        />
        <span className="inspector-value">{Math.round(t.rotation)}°</span>
      </label>
    </>
  );
}

function ColorFields({
  clip,
  dispatch,
}: {
  clip: VideoClip;
  dispatch: React.Dispatch<import('../../state/actions').Action>;
}) {
  const enabled = !!clip.color;
  const c: ColorAdjust = clip.color ?? NEUTRAL_COLOR;

  const update = (patch: Partial<ColorAdjust>) => {
    dispatch({
      type: 'SET_CLIP_COLOR',
      payload: { clipId: clip.id, color: { ...c, ...patch } },
    });
  };
  const toggle = (on: boolean) => {
    dispatch({
      type: 'SET_CLIP_COLOR',
      payload: { clipId: clip.id, color: on ? { ...NEUTRAL_COLOR } : null },
    });
  };

  return (
    <>
      <div className="inspector-field-group-header">
        <span>Color adjust</span>
        {enabled && (
          <button
            type="button"
            className="inspector-link-btn"
            onClick={() => dispatch({ type: 'SET_CLIP_COLOR', payload: { clipId: clip.id, color: { ...NEUTRAL_COLOR } } })}
          >
            Reset
          </button>
        )}
      </div>
      <label className="inspector-field">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle(e.target.checked)}
        />
      </label>
      {enabled && (
        <>
          <label className="inspector-field">
            <span>Bright</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={c.brightness}
              onChange={(e) => update({ brightness: Number(e.target.value) })}
            />
            <span className="inspector-value">{c.brightness.toFixed(2)}</span>
          </label>
          <label className="inspector-field">
            <span>Contrast</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={c.contrast}
              onChange={(e) => update({ contrast: Number(e.target.value) })}
            />
            <span className="inspector-value">{c.contrast.toFixed(2)}</span>
          </label>
          <label className="inspector-field">
            <span>Saturate</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={c.saturation}
              onChange={(e) => update({ saturation: Number(e.target.value) })}
            />
            <span className="inspector-value">{c.saturation.toFixed(2)}</span>
          </label>
          <label className="inspector-field">
            <span>Hue</span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={c.hue}
              onChange={(e) => update({ hue: Number(e.target.value) })}
            />
            <span className="inspector-value">{Math.round(c.hue)}°</span>
          </label>
        </>
      )}
    </>
  );
}

const TRANSITION_KINDS: TransitionKind[] = [
  'fade', 'fadeblack', 'fadewhite', 'dissolve',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'circleclose', 'pixelize', 'radial',
];

function TransitionFields({
  clip,
  dispatch,
}: {
  clip: Clip;
  dispatch: React.Dispatch<import('../../state/actions').Action>;
}) {
  const hasTransition = !!clip.transitionOut;
  return (
    <>
      <label className="inspector-field">
        <span>Transition out</span>
        <input
          type="checkbox"
          checked={hasTransition}
          onChange={(e) =>
            dispatch({
              type: 'SET_CLIP_TRANSITION',
              payload: {
                clipId: clip.id,
                transition: e.target.checked
                  ? { kind: 'fade', duration: DEFAULT_TRANSITION_DURATION }
                  : null,
              },
            })
          }
        />
      </label>
      {hasTransition && clip.transitionOut && (
        <>
          <label className="inspector-field">
            <span>Kind</span>
            <select
              value={clip.transitionOut.kind}
              onChange={(e) =>
                dispatch({
                  type: 'SET_CLIP_TRANSITION',
                  payload: {
                    clipId: clip.id,
                    transition: { ...clip.transitionOut!, kind: e.target.value as TransitionKind },
                  },
                })
              }
            >
              {TRANSITION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="inspector-field">
            <span>Duration</span>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={clip.transitionOut.duration}
              onChange={(e) =>
                dispatch({
                  type: 'SET_CLIP_TRANSITION',
                  payload: {
                    clipId: clip.id,
                    transition: { ...clip.transitionOut!, duration: Number(e.target.value) },
                  },
                })
              }
            />
            <span className="inspector-value">{clip.transitionOut.duration.toFixed(1)}s</span>
          </label>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0' }}>
            Preview shows fade; export uses the selected kind.
          </div>
        </>
      )}
    </>
  );
}
