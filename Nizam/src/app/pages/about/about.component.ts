import { Component } from '@angular/core';
import { BentoHighlightsComponent } from '../../components/bento-grid/bento-highlights.component';

@Component({
  selector: 'app-about',
  imports: [BentoHighlightsComponent],
  template: `
    <div class="about-page">
      <header class="page-header">
        <span class="eyebrow">Our story</span>
        <h1>About Amma Wears</h1>
        <p class="page-subtitle">Premium apparel with quality materials and comfortable designs.</p>
      </header>
      <div class="about-card">
        <p>Amma Wears is a fashion brand dedicated to providing premium apparel with quality materials and comfortable designs. We blend thoughtful design with premium quality to bring refined comfort and confident style to every customer.</p>
        <div class="about-points">
          <div class="about-point">
            <strong>Thoughtful design</strong>
            <span>Every piece starts with how real people move, wear, and live.</span>
          </div>
          <div class="about-point">
            <strong>Premium quality</strong>
            <span>Fabrics and stitching chosen to look good and last longer.</span>
          </div>
          <div class="about-point">
            <strong>Confident style</strong>
            <span>Wardrobe staples that work from casual days to evenings out.</span>
          </div>
        </div>
      </div>
      <app-bento-highlights
        eyebrow="Our design promise"
        title="Made for the way you live"
      />
    </div>`,
  styles: [`
    .about-page {
      max-width: 860px;
      margin: 0 auto;
      padding: 64px 24px 96px;
    }

    .page-header {
      margin-bottom: 32px;
    }

    .page-header .eyebrow {
      display: inline-block;
      font-size: 0.78rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--brand-primary);
      margin-bottom: 8px;
    }

    .page-header h1 {
      font-size: clamp(2rem, 3.4vw, 2.9rem);
      margin-bottom: 12px;
    }

    .page-header .page-subtitle {
      color: var(--text-light);
      font-size: 1.05rem;
    }

    .about-card {
      background: var(--surface);
      border: 1px solid var(--border-color);
      border-radius: 24px;
      padding: 40px;
      box-shadow: var(--shadow-card);
    }

    .about-card > p {
      color: var(--text-light);
      line-height: 1.85;
      font-size: 1.02rem;
      margin-bottom: 28px;
    }

    .about-points {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }

    .about-point {
      background: rgba(176, 141, 87, 0.05);
      border: 1px solid rgba(176, 141, 87, 0.12);
      border-radius: 16px;
      padding: 18px;
    }

    .about-point strong {
      display: block;
      margin-bottom: 6px;
      color: var(--brand-dark);
      font-size: 0.98rem;
    }

    .about-point span {
      color: var(--text-light);
      font-size: 0.88rem;
      line-height: 1.6;
    }

    @media (max-width: 640px) {
      .about-page {
        padding: 40px 18px 64px;
      }

      .about-card {
        padding: 24px 18px;
      }
    }
  `]
})
export class AboutComponent {
  constructor() {}
}