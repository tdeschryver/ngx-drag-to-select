import { Observable, pipe } from 'rxjs';
import { filter, map, withLatestFrom, distinctUntilChanged, endWith } from 'rxjs/operators';
import { MousePosition, SelectBox, SelectBoxInput, SelectContainerHost } from './models';
import { getRelativeMousePosition, hasMinimumSize } from './utils';

export interface DragState {
  state: string;
  down?: MousePosition;
  move?: MousePosition;
}

export const createSelectBox = () => (source: Observable<DragState>): Observable<SelectBox<number>> =>
  source.pipe(
    map(({ state, down, move }: DragState) => {
      if (state === 'DRAGGING_START') {
        return {
          left: down.x,
          top: down.y,
          width: 0,
          height: 0,
          opacity: 0
        };
      }

      if (state === 'DRAGGING_END') {
        return {
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          opacity: 0
        };
      }

      const width = move.x - down.x;
      const height = move.y - down.y;

      return {
        left: width < 0 ? move.x : down.x,
        top: height < 0 ? move.y : down.y,
        width: Math.abs(width),
        height: Math.abs(height),
        opacity: 1
      };
    })
  );

export const whenSelectBoxVisible = (selectBox$: Observable<SelectBox<number>>) => (source: Observable<Event>) =>
  source.pipe(
    withLatestFrom(selectBox$),
    filter(([, selectBox]) => hasMinimumSize(selectBox, 0, 0)),
    map(([event, _]) => event)
  );

export const distinctKeyEvents = () => (source: Observable<KeyboardEvent>) =>
  source.pipe(
    distinctUntilChanged((prev, curr) => {
      return prev.keyCode === curr.keyCode && prev.type === curr.type;
    })
  );
