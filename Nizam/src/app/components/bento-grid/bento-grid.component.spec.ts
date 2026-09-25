import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BentoGridComponent } from './bento-grid.component';

@Component({
  standalone: true,
  imports: [BentoGridComponent],
  template: `
    <app-bento-grid ariaLabel="Catalog highlights" [columns]="6">
      <article class="bento-tile bento-tile--hero">Featured</article>
      <article class="bento-tile bento-tile--wide">Wide</article>
      <article class="bento-tile bento-tile--tall">Tall</article>
    </app-bento-grid>
  `
})
class TestHostComponent {}

describe('BentoGridComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent]
    }).compileComponents();
  });

  it('renders projected tiles and exposes the configured grid configuration', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('.bento-grid') as HTMLElement;

    expect(grid.getAttribute('role')).toBe('region');
    expect(grid.getAttribute('aria-label')).toBe('Catalog highlights');
    expect(grid.style.getPropertyValue('--bento-columns')).toBe('6');
    expect(fixture.nativeElement.querySelectorAll('.bento-tile').length).toBe(3);
  });

  it('supports hero, wide, and tall tile zones', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.bento-tile--hero')).toBeTruthy();
    expect(element.querySelector('.bento-tile--wide')).toBeTruthy();
    expect(element.querySelector('.bento-tile--tall')).toBeTruthy();
  });
});
