import { AfterViewInit, Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { SwiperComponent } from 'swiper/angular';
import SwiperCore, { SwiperOptions, Pagination } from 'swiper';
import { ChangeDetectorRef, NgZone } from '@angular/core';
SwiperCore.use([Pagination]);

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class WelcomePage implements AfterViewInit {

  language = '';
  last_slide = false;
  logoSrc = 'assets/logo-diritti.svg';

  @ViewChild('swiper', { static: false }) swiper?: SwiperComponent;

  private slideCount = 0;

  config: SwiperOptions = {
    slidesPerView: 1,
    spaceBetween: 24,
    speed: 450,
    centeredSlides: true,
    allowTouchMove: true,
    pagination: { clickable: true },
  };

  constructor(
    private router: Router,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  ngAfterViewInit(): void {
    // Preload logo
    const img = new Image();
    img.src = this.logoSrc;

    const ref = this.swiper?.swiperRef;
    if (!ref) return;

    // 1) Quando swiper ha finito l'init, prendo il numero reale di slide
    ref.on('afterInit', () => {
      this.zone.run(() => {
        this.slideCount = ref.slides?.length ?? 0;
        this.updateLastSlide();
        this.cdr.detectChanges();
      });
    });

    // 2) Se per qualsiasi motivo cambia la lunghezza (template/condizionali)
    ref.on('slidesLengthChange', () => {
      this.zone.run(() => {
        this.slideCount = ref.slides?.length ?? 0;
        this.updateLastSlide();
        this.cdr.detectChanges();
      });
    });

    // 3) Aggiorna ad ogni cambio slide
    ref.on('slideChange', () => {
      this.zone.run(() => {
        this.updateLastSlide();
        this.cdr.detectChanges();
      });
    });

    // NB: niente chiamata immediata a updateLastSlide() qui,
    // aspettiamo afterInit per evitare il "total=1" finto.
  }

  // Chiamato dal template, ok tenerlo
  swiperSlideChanged(_: any) {
    this.updateLastSlide();
  }

  nextSlide() {
    this.swiper?.swiperRef.slideNext(450);
  }

  private updateLastSlide() {
    const ref = this.swiper?.swiperRef;
    if (!ref) return;

    const total = this.slideCount || ref.slides?.length || 0;
    const i = (ref as any).realIndex ?? ref.activeIndex ?? 0;

    // SOLO se ci sono davvero più di 1 slide
    this.last_slide = total > 1 && i >= total - 1;
  }

  getStarted() {
    this.router.navigateByUrl('/signin', { replaceUrl: true });
  }

  goToPayPal() {
    this.router.navigate(['/paypal']);
  }
}
