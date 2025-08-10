import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { AiPage } from './ai.page';

const routes: Routes = [
  {
    path: '',
    component: AiPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AiPageRoutingModule {}
