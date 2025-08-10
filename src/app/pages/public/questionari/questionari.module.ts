import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { QuestionariPageRoutingModule } from './questionari-routing.module';

import { QuestionariPage } from './questionari.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    QuestionariPageRoutingModule
  ],
  declarations: [QuestionariPage]
})
export class QuestionariPageModule {}
