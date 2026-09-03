import React from 'react';
import type { ReactNode } from 'react';
import type { WebMissionCard } from '../../src/interfaces/web/transport.js';

/**
 * Presentational board card (ADR 0055). It renders only the server-owned
 * facts received on the wire DTO: the latest checkpoint indicator, the
 * pull-request line, and the current review round meter. Absent facts render
 * explicit unavailable text. Nothing is derived from lane, flags, or
 * lifecycle state, and the link `href` is set only from the received
 * `pullRequest.url` — never constructed.
 */
export function MissionCardView({ card }: { readonly card: WebMissionCard }) {
  const checkpointLabel = card.checkpoint !== null ? card.checkpoint.replace(/\.md$/, '') : null;
  return (
    <article className="mission-card">
      <h3 className="mission-card__title">{card.title}</h3>
      <p className="mission-card__checkpoint">
        {checkpointLabel === null
          ? `Checkpoint unavailable · gate ${card.gate}`
          : `Checkpoint ${checkpointLabel} (gate ${card.gate})`}
      </p>
      <p className="mission-card__pull-request">{pullRequestLine(card)}</p>
      <p className="mission-card__review-meter">{reviewMeterText(card)}</p>
    </article>
  );
}

function pullRequestLine(card: WebMissionCard): ReactNode {
  if (card.pullRequest === null) {
    return 'Pull request unavailable';
  }
  if (card.pullRequest.url === null) {
    return `PR #${card.pullRequest.id} (no link)`;
  }
  return (
    <a className="mission-card__pr-link" href={card.pullRequest.url}>
      PR #{card.pullRequest.id}
    </a>
  );
}

function reviewMeterText(card: WebMissionCard): string {
  if (card.reviewRound === null || card.reviewPhase === null) {
    return 'Review round unavailable';
  }
  return `Review round ${card.reviewRound} · ${card.reviewPhase}`;
}
