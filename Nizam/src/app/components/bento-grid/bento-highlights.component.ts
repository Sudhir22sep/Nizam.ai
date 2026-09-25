import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BentoGridComponent } from '../bento-grid/bento-grid.component';

@Component({
  selector: 'app-bento-highlights',
  standalone: true,
  imports: [RouterLink, BentoGridComponent],
  template: `
    <section class="page-bento" [attr.aria-label]="ariaLabel">
      <div class="page-bento__head">
        <span class="eyebrow">{{ eyebrow }}</span>
        <h2>{{ title }}</h2>
      </div>
      <app-bento-grid [ariaLabel]="ariaLabel" [columns]="3">
        <article class="bento-tile bento-tile--hero bento-tile--light">
          <span class="eyebrow">Curated for you</span>
          <h3>Find your next favorite piece.</h3>
          <p>Explore refined everyday style with considered fabrics and effortless silhouettes.</p>
          <a routerLink="/products" class="bento-tile__cta">Shop the collection <span aria-hidden="true">→</span></a>
        </article>
        <article class="bento-tile bento-tile--accent">
          <span class="eyebrow">01 / 02</span>
          <h3>Modern essentials</h3>
          <p>Clean lines, confident color, and easy layering.</p>
          <a routerLink="/products" aria-label="Explore modern essentials">↗</a>
        </article>
        <article class="bento-tile bento-tile--tall">
          <img src="/images/products/Tshirt.jpeg" alt="Amma Wears everyday collection" loading="lazy" />
          <div class="bento-tile__overlay">
            <span class="eyebrow">Everyday, elevated</span>
            <h3>Made for repeat wear</h3>
          </div>
        </article>
      </app-bento-grid>
    </section>
  `,
  styles: [`
    .page-bento { max-width: 1200px; margin: 0 auto 80px; padding: 0 24px; }
    .page-bento__head { margin-bottom: 28px; }
    .page-bento__head h2 { margin: 0; font-size: clamp(1.8rem, 2.5vw, 2.4rem); }
    .page-bento .eyebrow { color: var(--brand-primary); }
    .page-bento .bento-tile { display: flex; flex-direction: column; justify-content: flex-end; }
    .page-bento .bento-tile h3 { margin: 0 0 10px; font-size: clamp(1.25rem, 1.8vw, 1.8rem); }
    .page-bento .bento-tile p { margin: 0 0 18px; }
    .page-bento .bento-tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .6; }
    .page-bento .bento-tile--tall::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 20%, rgb(8 18 32 / 84%)); }
    .page-bento .bento-tile__overlay { position: relative; z-index: 1; }
    .bento-tile__cta { display: inline-flex; align-items: center; align-self: flex-start; gap: 8px; margin-top: auto; color: var(--brand-dark); font-size: .88rem; font-weight: 800; text-decoration: none; }
    .bento-tile:not(.bento-tile--light) .bento-tile__cta { color: #fff; }
    .page-bento .bento-tile > a:last-child:not(.bento-tile__cta) { position: absolute; top: 24px; right: 24px; color: #fff; font-size: 1.5rem; text-decoration: none; }
    @media (max-width: 640px) { .page-bento { margin-bottom: 56px; padding: 0 18px; } .page-bento__head { margin-bottom: 20px; } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BentoHighlightsComponent {
  @Input() eyebrow = 'The Amma Wears edit';
  @Input() title = 'A little inspiration for your wardrobe';
  @Input() ariaLabel = 'Amma Wears highlights';
}
