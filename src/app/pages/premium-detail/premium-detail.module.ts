import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { PremiumDetailPageRoutingModule } from './premium-detail-routing.module';
import { PremiumDetailPage } from './premium-detail.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    PremiumDetailPageRoutingModule,
    ReactiveFormsModule, // necessario per [formGroup]/formControlName
    FormsModule,         // se usi anche [(ngModel)]
  ],
  declarations: [PremiumDetailPage]
})
export class PremiumDetailPageModule {}
