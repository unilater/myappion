import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { QuestionariPage } from './questionari.page';

const routes: Routes = [
  {
    path: '',
    component: QuestionariPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class QuestionariPageRoutingModule {}
