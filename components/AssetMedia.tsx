"use client";

import { useState } from "react";

export function AssetMedia({ assetId, mediaType, name }: { assetId: string; mediaType: string; name: string }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const original = `/api/assets/${assetId}/media`;
  const preview = failed ? <span className="preview-fallback">プレビューなし<br /><small>開いて作品を見る</small></span> :
    <img loading="lazy" decoding="async" src={`${original}?thumbnail=1`} alt={name} width={640} height={480} onError={() => setFailed(true)} />;

  if (mediaType === "video") {
    if (playing) return <video controls autoPlay playsInline preload="none" src={original} aria-label={name} />;
    return <button className="video-preview" onClick={() => setPlaying(true)} aria-label={`${name}を再生`}>
      {preview}<span className="play-icon" aria-hidden="true">▶</span><span className="play-label">動画を再生</span>
    </button>;
  }
  return <a className="image-preview" href={original} target="_blank" rel="noopener noreferrer" aria-label={`${name}の原本を開く`}>{preview}</a>;
}
