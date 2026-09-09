import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ServerOnlyService {
  constructor() {
    console.log('ServerOnlyService instantiated on the server');
  }
}